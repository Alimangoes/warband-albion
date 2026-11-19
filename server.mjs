import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, createHash, createPublicKey, verify } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { createDiscordGuide, withRecordLock } from './discord-guide.mjs';
import { helpCommand, helpReply } from './discord-help.mjs';
import { combatPrices, estimateSilver, priceCombatItems } from './combat-market.mjs';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { openPostgres, openSQLite, namespaceStore } from './storage.mjs';
import { albion, canPost, discord, isAdmin, Problem, regions, request } from './providers.mjs';
import { demoChannels, demoParties, demoRoles, demoRoster, demoSettings } from './demo.mjs';

const port = Number(process.env.PORT || 4317);
const onVercel = process.env.VERCEL === '1';
const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const base = new URL(process.env.APP_URL || (onVercel && vercelDomain ? 'https://' + vercelDomain : 'http://localhost:' + port));
const demo = onVercel ? process.env.DEMO_MODE === 'true' : process.env.DEMO_MODE !== 'false';
const { DISCORD_CLIENT_ID: client, DISCORD_CLIENT_SECRET: secret, DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: defaultGuildId } = process.env;
const multiServer = process.env.MULTI_SERVER_MODE === 'true';
const serverContext = new AsyncLocalStorage();
const serverId = () => serverContext.getStore()?.guildId || defaultGuildId;
const permittedServers = new Set((process.env.DISCORD_ALLOWED_GUILD_IDS || '').split(',').map(id => id.trim()).filter(Boolean));
const allowedServer = id => snowflake(id) && (!multiServer || !permittedServers.size || permittedServers.has(id));
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
const secure = base.protocol === 'https:';
const snowflake = value => /^\d{17,20}$/.test(value || '');
if ((!secure && !(loopback && base.protocol === 'http:')) || base.href !== base.origin + '/') throw new Error('Set APP_URL to the HTTPS public origin or an HTTP localhost origin.');
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (multiServer && onVercel && process.env.VERCEL_ENV === 'preview' && !process.env.DATA_NAMESPACE) {
  throw new Error('Set DATA_NAMESPACE for the multi-server preview.');
}
const setupRequired = (!demo && (!snowflake(client) || (!multiServer && !snowflake(defaultGuildId)) || !secret || !token))
  || (onVercel && (!secure || !connectionString));
if (setupRequired && !onVercel) throw new Error('Set the four DISCORD_ values in .env.');
const bot = 'Bot ' + token;
const interactionKey = /^[a-f0-9]{64}$/i.test(process.env.DISCORD_PUBLIC_KEY || '') ? createPublicKey({
  key: Buffer.from('302a300506032b6570032100' + process.env.DISCORD_PUBLIC_KEY, 'hex'), format: 'der', type: 'spki'
}) : null;
const itemCatalog = new Map(JSON.parse(readFileSync(new URL('./public/albion-items.json', import.meta.url)))
  .map(item => [item[0], item]));
const buildSlots = ['weapon', 'offhand', 'head', 'chest', 'feet', 'cape', 'food', 'potion'];
const roleEmoji = ['🛡️', '💚', '⚔️', '🏹', '🔮', '🔥', '❄️', '⚡', '💀', '🌿', '🎵', '🐺', '🦅', '🌀', '🪓', '🔨', '🗡️', '🧪', '👑', '⭐'];
const expertiseRoles = ['noobie', 'ganker', 'fame whore', 'caller', 'support', 'healer', 'tank', 'DPS'];
const expertiseRoleAllowed = (role, organizerId) => role && role.id !== serverId() && role.id !== organizerId &&
  !role.managed && role.permissions === '0';
const hasChannelOverwrite = (channels, id) => channels.some(channel =>
  channel.permission_overwrites?.some(overwrite => overwrite.type === 0 && overwrite.id === id));
const callback = new URL('/auth/discord/callback', base).href;
const key = () => randomBytes(16).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
function workspaceUrl(party) {
  const url = new URL('/', base);
  if (party) url.searchParams.set('party', party);
  if (multiServer && snowflake(serverId())) url.searchParams.set('server', serverId());
  return url;
}
function discordInviteUrl() {
  const permissions = 1024n | 2048n | 16384n | 65536n | (1n << 28n) | (1n << 34n) | (1n << 35n) | (1n << 38n);
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: client, scope: 'bot applications.commands', permissions: String(permissions), integration_type: '0' });
  if (permittedServers.size === 1) {
    url.searchParams.set('guild_id', [...permittedServers][0]);
    url.searchParams.set('disable_guild_select', 'true');
  }
  return url.href;
}
async function discordGuilds(authorization) {
  const guilds = [];
  let after = '';
  for (let page = 0; page < 10; page++) {
    const rows = await discord('/users/@me/guilds?limit=200' + (after ? '&after=' + after : ''), authorization);
    if (!Array.isArray(rows)) throw new Problem(502, 'Discord returned an unexpected server list.');
    guilds.push(...rows.filter(row => allowedServer(row.id)));
    if (rows.length < 200) return guilds;
    after = rows.at(-1).id;
  }
  throw new Problem(502, 'Discord returned too many server pages. Try again shortly.');
}
async function workspacesFor(profile) {
  const installed = new Set((await discordGuilds(bot)).map(guild => guild.id));
  return (profile.servers || []).filter(guild => allowedServer(guild.id)).map(guild => ({
    id: guild.id, name: guild.name, installed: installed.has(guild.id),
    canInstall: guild.owner || (/^\d+$/.test(guild.permissions || '') && isAdmin(guild.permissions))
  }));
}
async function workspaceRoutes(req, res) {
  if (!multiServer) throw new Problem(404, 'Page not found.');
  const profile = await get(sessionKey(req));
  if (!profile) throw new Problem(401, 'Sign in with Discord first.');
  if (req.method === 'GET') return json(res, { servers: await workspacesFor(profile), inviteUrl: discordInviteUrl() });
  const data = await body(req);
  if (!allowedServer(data.id) || !profile.servers?.some(server => server.id === data.id)) {
    throw new Problem(403, 'Choose a Discord server you belong to.');
  }
  await serverContext.run({ guildId: data.id }, async () => {
    const member = await memberFor(profile);
    const [settings, provisioned] = await Promise.all([get(data.id + ':settings'), get(expertiseMappingKey({ scope: data.id }), {})]);
    requireLoginRole(settings, member.roleIds, provisioned);
    if (!settings && !member.admin) throw new Problem(403, 'A server admin needs to complete Warband setup first.');
  });
  await db.change(sessionKey(req), null, Date.now() + demoAge * 1000, current => {
    if (!current || current.id !== profile.id) throw new Problem(401, 'Sign in again.');
    current.workspaceId = data.id;
  });
  return json(res, { selected: data.id });
}

const db = setupRequired ? null : namespaceStore(connectionString ? openPostgres(connectionString) : openSQLite(), process.env.DATA_NAMESPACE || '');
const { get, put, remove } = db || {};
const auth = demo ? 'albion_demo' : 'albion_session';
const csrf = 'albion_oauth';
const cookie = (name, value, age) => name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age + (secure ? '; Secure' : '');
const readCookie = (req, name) => (req.headers.cookie || '').split(';').map(part => part.trim())
  .find(part => part.startsWith(name + '='))?.slice(name.length + 1) || '';
const sessionKey = req => 'session:' + hash(readCookie(req, auth));
const demoAge = 7 * 86400;
async function session(res, profile, clearState = false) {
  const id = key();
  await put('session:' + hash(id), profile, Date.now() + demoAge * 1000);
  res.setHeader('Set-Cookie', [cookie(auth, id, demoAge), ...(clearState ? [cookie(csrf, '', 0)] : [])]);
}
const limits = new Map();
async function throttle(identity, max) {
  const now = Date.now();
  if (db.limit) {
    if (!await db.limit('limit:' + hash(identity), now, now + 60000, max)) throw new Problem(429, 'Too many requests. Try again shortly.');
    return;
  }
  const old = limits.get(identity);
  const count = old?.expires > now ? old.count + 1 : 1;
  limits.set(identity, { count, expires: old?.expires > now ? old.expires : now + 60000 });
  if (count > max) throw new Problem(429, 'Too many requests. Try again shortly.');
}
let nextCleanup = 0;
async function cleanup() {
  const now = Date.now();
  if (now < nextCleanup) return;
  nextCleanup = now + 60000;
  try {
    await db.sweep();
  } catch {
    // A failed cleanup should not prevent otherwise valid requests.
    console.error('Warband could not remove expired database records.');
  }
  for (const [id, entry] of limits) if (entry.expires <= now) limits.delete(id);
}
const clientAddress = req => {
  const forwarded = onVercel && req.headers['x-vercel-forwarded-for'];
  return typeof forwarded === 'string' ? forwarded : req.socket.remoteAddress;
};

const imageHash = value => typeof value === 'string' && /^(?:a_)?[a-f0-9]{32}$/i.test(value);
const discordCdn = 'https://cdn.discordapp.com/';
function discordAdmin(id, ownerId, heldRoles) {
  return ownerId === id || isAdmin(heldRoles.reduce((all, role) => all | BigInt(role.permissions), 0n));
}
const canOrganize = (admin, roles, organizerRole) => admin || Boolean(organizerRole && roles.includes(organizerRole));
const organizerRoleId = (settings, provisioned) =>
  !demo && expertiseRoleIds(settings, provisioned).has(settings?.roleId) ? '' : settings?.roleId;
const organizerRoleName = ctx => ctx.member.allRoles?.find(role => role.id === ctx.organizerRole)?.name ?? null;
function discordAvatar(id, member) {
  if (!snowflake(id) || member?.user?.id !== id) return null;
  const { avatar, discriminator } = member.user;
  if (imageHash(member.avatar)) return discordCdn + 'guilds/' + serverId() + '/users/' + id + '/avatars/' + member.avatar + '.webp?size=64';
  if (imageHash(avatar)) return discordCdn + 'avatars/' + id + '/' + avatar + '.webp?size=64';
  const index = /^\d{4}$/.test(discriminator) && discriminator !== '0000'
    ? Number(discriminator) % 5 : (BigInt(id) >> 22n) % 6n;
  return discordCdn + 'embed/avatars/' + index + '.png';
}
async function memberFor(profile) {
  const [member, guild, roles] = await Promise.all([
    discord('/guilds/' + serverId() + '/members/' + profile.id, bot).catch(error => {
      if (error.status === 404) throw new Problem(403, 'Join the configured Discord server to access the board.');
      throw error;
    }),
    discord('/guilds/' + serverId(), bot),
    discord('/guilds/' + serverId() + '/roles', bot)
  ]);
  const held = roles.filter(role => role.id === serverId() || member.roles.includes(role.id));
  if (member.pending) throw new Problem(403, 'Complete Discord membership screening first.');
  const serverIcon = imageHash(guild.icon) ? discordCdn + 'icons/' + serverId() + '/' + guild.icon + '.webp?size=64' : null;
  return { admin: discordAdmin(profile.id, guild.owner_id, held), ownerId: guild.owner_id, roleIds: member.roles, nickname: member.nick,
    roles: held.filter(role => role.id !== serverId()).map(role => role.name), server: guild.name, serverIcon,
    avatarUrl: discordAvatar(profile.id, member), allRoles: roles };
}
async function context(req, res, board) {
  let profile = await get(sessionKey(req));
  if (!profile && demo && board) {
    await throttle('demo:' + clientAddress(req), 15);
    profile = { id: key(), name: 'You', expires: Date.now() + demoAge * 1000 };
    await put(profile.id + ':parties', demoParties(), profile.expires);
    await session(res, profile);
  }
  if (!profile) return null;
  if (multiServer && !demo && !profile.workspaceId) return { profile, workspaceSelection: true };
  if (multiServer && !demo && (!allowedServer(profile.workspaceId) || !profile.servers?.some(server => server.id === profile.workspaceId))) {
    throw new Problem(403, 'Choose a Discord server you belong to.');
  }
  const scope = demo ? profile.id : serverId();
  const member = demo ? { admin: true, roleIds: ['1'], roles: ['Guild Officer'], server: demoSettings.server } : await memberFor(profile);
  const characterPrefix = scope + ':character:';
  const characterKey = characterPrefix + profile.id;
  const expertiseKey = scope + ':expertise:' + profile.id;
  const [settings, savedCharacter, expertise, provisioned] = await Promise.all([
    get(scope + ':settings', demo ? demoSettings : null), get(characterKey), get(expertiseKey, []),
    demo ? {} : get(expertiseMappingKey({ scope }), {})
  ]);
  const availableRoles = await get(scope + ':expertise-catalog', expertiseRoles);
  requireLoginRole(settings, member.roleIds, provisioned);
  const character = demo || !savedCharacter ? savedCharacter : await currentLinkedCharacter(scope, savedCharacter, board);
  const organizerRole = organizerRoleId(settings, provisioned);
  const guest = hasGuestRole(settings, member.roleIds, provisioned);
  return { profile, scope, member, settings, characterPrefix, characterKey, character, expertiseKey, availableRoles, organizerRole, guest,
    expertise: expertise.filter(name => availableRoles.includes(name)),
    manager: canOrganize(member.admin, member.roleIds, organizerRole) };
}
const linkedToGuild = (character, region, id) => Boolean(id && character?.region === region && character.guildId === id);
const hasGuestRole = (settings, roles, provisioned) => Boolean(settings?.guestRoleId &&
  Array.isArray(roles) && roles.includes(settings.guestRoleId) && !expertiseRoleIds(settings, provisioned).has(settings.guestRoleId));
function onboardingStep(ctx) {
  if (demo) return null;
  const guild = ctx.settings?.albionGuild;
  if (!guild) return ctx.member?.admin ? null : 'guild-setup';
  if (!ctx.character || ctx.character.region !== ctx.settings.region ||
      Boolean(ctx.guest) === linkedToGuild(ctx.character, ctx.settings.region, guild.id)) return 'character';
  return ctx.expertise.length || !ctx.availableRoles.length ? null : 'roles';
}
const guildMembershipError = guild => 'You are not part of the in-game guild ' + guild.name + '. Link a character who is a member.';
const guestMembershipError = guild => 'Your Discord Guest role requires an Albion character outside ' + guild.name + '.';
const requiresMatchingNickname = settings => settings?.requireMatchingNickname ?? (!demo && Boolean(settings));
function matchesDiscordNickname(nickname, characterName) {
  if (typeof nickname !== 'string') return false;
  // Albion Assistant puts up to two bracketed guild/alliance tags before the IGN.
  const name = nickname.trim().replace(/^(?:\[[^\[\]\r\n]{1,7}\]\s*){1,2}/u, '');
  return name.toLowerCase() === characterName.toLowerCase();
}
function requireManager(ctx, admin = false) {
  if (!(admin ? ctx.member.admin : ctx.manager)) throw new Problem(403, 'Your Discord role cannot perform this action.');
}
const expertiseMappingKey = ctx => ctx.scope + ':expertise-discord-roles';
const expertiseRoleIds = (settings, provisioned) => new Set([
  ...Object.values(settings?.expertiseRoleIds || {}), ...Object.values(provisioned)
]);
class LoginRoleRequired extends Problem {
  constructor() {
    super(403, 'You need the required Discord server role to sign in to Warband. Contact a server admin.');
  }
}
function requireLoginRole(settings, roleIds, provisioned) {
  const selfAssigned = expertiseRoleIds(settings, provisioned);
  if (settings?.requireLoginRole && (!Array.isArray(roleIds) ||
      !allowedLoginRoles(settings).some(id => !selfAssigned.has(id) && roleIds.includes(id)))) {
    throw new LoginRoleRequired();
  }
}
const allowedLoginRoles = settings => settings?.loginRoleIds ?? (settings?.loginRoleId ? [settings.loginRoleId] : []);
const protectedAccessRole = (settings, id) => allowedLoginRoles(settings).includes(id) || id === settings?.guestRoleId;
function withSyncLock(lock, run) {
  return withRecordLock(db, lock, 'Roles are already syncing. Try again shortly.', run);
}
async function setupExpertiseRoles(ctx, data) {
  requireManager(ctx, true);
  return withSyncLock(expertiseMappingKey(ctx) + ':sync', async () => {
    const catalogKey = ctx.scope + ':expertise-catalog';
    const catalog = await get(catalogKey, expertiseRoles);
    const action = data.action || 'sync';
    const name = action === 'sync' ? '' : field(data.name, 1, 100, 'Role name');
    if (!['add', 'delete', 'sync'].includes(action)) throw new Problem(400, 'Choose a role action.');
    if (action === 'add' && catalog.some(role => role.toLowerCase() === name.toLowerCase())) {
      throw new Problem(409, 'A role with that name already exists.');
    }
    if (action === 'delete' && !catalog.includes(name)) throw new Problem(404, 'Warband role not found.');
    const next = action === 'add' ? [...catalog, name] : catalog.filter(role => role !== name);
    if (!demo) await configureDiscordExpertise(ctx, catalog, action, name);
    if (action === 'delete') await db.removeRoleSelection(ctx.scope + ':expertise:', name);
    if (action !== 'sync') await put(catalogKey, next, ctx.profile.expires);
    return { count: next.length };
  });
}
async function configureDiscordExpertise(ctx, catalog, action, name) {
  const guildPath = '/guilds/' + serverId();
  const [roles, channels, identity, settings, saved] = await Promise.all([
    discord(guildPath + '/roles', bot), discord(guildPath + '/channels', bot), discord('/users/@me', bot),
    get(ctx.scope + ':settings'), get(expertiseMappingKey(ctx))
  ]);
  const member = await discord(guildPath + '/members/' + identity.id, bot);
  const botRoles = roles.filter(role => role.id === serverId() || member.roles.includes(role.id));
  const permissions = botRoles.reduce((bits, role) => bits | BigInt(role.permissions), 0n);
  if (!(permissions & (8n | 268435456n))) {
    throw new Problem(409, 'Enable Manage Roles on the Warband bot role in Discord, then try again.');
  }
  const outranks = role => botRoles.some(botRole => botRole.position > role.position ||
    (botRole.position === role.position && BigInt(botRole.id) < BigInt(role.id)));
  const allowed = role => expertiseRoleAllowed(role, settings?.roleId) && !protectedAccessRole(settings, role.id) &&
    !hasChannelOverwrite(channels, role.id) && outranks(role);
  const previous = { ...settings?.expertiseRoleIds, ...saved };
  if (action === 'delete') {
    const id = Object.hasOwn(previous, name) ? previous[name] : null;
    const role = roles.find(item => item.id === id);
    if (id && catalog.some(other => other !== name && previous[other] === id)) {
      throw new Problem(409, 'This Discord role is mapped to more than one Warband role.');
    }
    if (role && !allowed(role)) throw new Problem(409, 'This Discord role is protected or above the bot.');
    if (role) await discord(guildPath + '/roles/' + role.id, bot, undefined, 'DELETE').catch(error => {
      if (error.upstreamStatus !== 404) throw error;
    });
    await put(expertiseMappingKey(ctx), { ...previous, [name]: null });
    return;
  }
  const resolved = (action === 'add' ? [name] : catalog).map(name => {
    const matching = roles.filter(role => role.name.toLowerCase() === name.toLowerCase());
    const existing = roles.find(role => role.id === previous[name]) ||
      (action === 'sync' && expertiseRoles.includes(name) && matching.length === 1 ? matching[0] : null);
    if ((existing || matching.length) && !allowed(existing)) {
      throw new Problem(409, 'Check the Discord role “' + name + '”. Warband needs a role below the bot with all permissions off and no channel overrides.');
    }
    return [name, existing];
  });
  const outcomes = await Promise.allSettled(resolved.map(async ([name, existing]) => {
    const role = existing || await discord(guildPath + '/roles', bot, { name, permissions: '0', hoist: false, mentionable: false });
    if (!allowed(role)) throw new Problem(409, 'Move the Warband bot above “' + name + '” in Discord, then try again.');
    return [name, role.id];
  }));
  const failed = outcomes.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  const mapping = { ...previous, ...Object.fromEntries(outcomes.filter(result => result.status === 'fulfilled').map(result => result.value)) };
  await put(expertiseMappingKey(ctx), mapping);
  if (failed) throw failed.reason;
}
async function saveExpertise(ctx, selected) {
  return withSyncLock(expertiseMappingKey(ctx) + ':sync', async () => withSyncLock(ctx.expertiseKey + ':sync', async () => {
    const catalog = await get(ctx.scope + ':expertise-catalog', expertiseRoles);
    if (!Array.isArray(selected) || (!selected.length && catalog.length) || selected.length > catalog.length ||
        selected.some(role => !catalog.includes(role)) || new Set(selected).size !== selected.length) {
      throw new Problem(400, 'Choose at least one available role.');
    }
    if (!demo && ctx.settings?.albionGuild && !await get(ctx.characterKey)) {
      throw new Problem(409, 'Link your Albion character before choosing roles.');
    }
    await put(ctx.expertiseKey, selected, ctx.profile.expires);
    return syncExpertise(ctx, selected, catalog);
  }));
}
async function syncExpertise(ctx, selected, catalog) {
  if (demo) return { synced: true };
  const [settings, saved] = await Promise.all([get(ctx.scope + ':settings'), get(expertiseMappingKey(ctx))]);
  const mapping = { ...settings?.expertiseRoleIds, ...saved };
  const [member, channels, currentRoles] = await Promise.all([
    discord('/guilds/' + serverId() + '/members/' + ctx.profile.id, bot),
    discord('/guilds/' + serverId() + '/channels', bot),
    discord('/guilds/' + serverId() + '/roles', bot)
  ]).catch(() => []);
  if (!member || member.pending || !Array.isArray(channels)) return { synced: false };
  const roles = catalog.map(name => currentRoles.find(role => role.id === mapping[name]));
  const valid = role => expertiseRoleAllowed(role, settings?.roleId) && !protectedAccessRole(settings, role.id) &&
    !hasChannelOverwrite(channels, role.id);
  const missing = roles.some((role, i) => selected.includes(catalog[i]) && !valid(role));
  const changes = await Promise.allSettled(roles.map((role, i) => {
    if (!valid(role)) return;
    const wantsRole = selected.includes(catalog[i]);
    if (wantsRole === member.roles.includes(role.id)) return;
    return discord('/guilds/' + serverId() + '/members/' + ctx.profile.id + '/roles/' + role.id, bot,
      undefined, wantsRole ? 'PUT' : 'DELETE');
  }));
  return { synced: !missing && changes.every(result => result.status === 'fulfilled'), ...(missing ? { reason: 'setup' } : {}) };
}
async function removeDiscordExpertise(ctx) {
  if (demo) return;
  const [settings, provisioned] = await Promise.all([get(ctx.scope + ':settings'), get(expertiseMappingKey(ctx), {})]);
  const roleIds = expertiseRoleIds(settings, provisioned);
  const memberPath = '/guilds/' + serverId() + '/members/' + ctx.profile.id;
  const member = await discord(memberPath, bot);
  const held = member.roles.filter(id => snowflake(id) && roleIds.has(id) && id !== serverId() &&
    id !== settings?.roleId && !protectedAccessRole(settings, id));
  const results = await Promise.allSettled(held.map(id => discord(memberPath + '/roles/' + id, bot, undefined, 'DELETE')));
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) {
    if (failed.some(result => result.reason.upstreamStatus === 403)) {
      throw new Problem(403, 'Discord denied role removal. Ask an admin to check Warband’s Manage Roles permission and role order, then retry Unlink.');
    }
    throw new Problem(502, 'Discord role removal could not be completed. Please retry Unlink.');
  }
}
const guidePermissions = 1n << 14n; // Embed Links
const guides = new Map();
function discordGuide() {
  if (demo || !db || !snowflake(serverId())) return null;
  if (!guides.has(serverId())) guides.set(serverId(), createDiscordGuide({ db, bot, base: workspaceUrl(), guildId: serverId() }));
  return guides.get(serverId());
}
async function options(ctx) {
  requireManager(ctx, true);
  if (demo) return { roles: demoRoles, channels: demoChannels, expertiseRoles: [] };
  const [channels, identity, provisioned, guide] = await Promise.all([
    discord('/guilds/' + serverId() + '/channels', bot), discord('/users/@me', bot), get(expertiseMappingKey(ctx), {}), discordGuide().status()
  ]);
  const botMember = await discord('/guilds/' + serverId() + '/members/' + identity.id, bot);
  const roles = ctx.member.allRoles;
  const selfAssigned = expertiseRoleIds(ctx.settings, provisioned);
  const compact = list => list.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { roles: compact(roles.filter(role => role.id !== serverId() && !role.managed && !selfAssigned.has(role.id))),
    expertiseRoles: compact(roles.filter(role => expertiseRoleAllowed(role) && !protectedAccessRole(ctx.settings, role.id) && !hasChannelOverwrite(channels, role.id))),
    channels: channels.filter(channel => [0, 5].includes(channel.type) && canPost(serverId(), roles, botMember, channel))
      .map(channel => ({ id: channel.id, name: channel.name, type: channel.type,
        canPostGuide: channel.type === 0 && canPost(serverId(), roles, botMember, channel, guidePermissions) }))
      .sort((a, b) => a.name.localeCompare(b.name)), guide };
}
async function saveDiscordGuide(ctx, data) {
  requireManager(ctx, true);
  if (typeof data.enabled !== 'boolean') throw new Problem(400, 'Choose whether to enable the Warband guide.');
  if (demo) throw new Problem(409, 'Discord guide posting is unavailable in demo mode.');
  if (data.enabled) {
    const channel = (await options(ctx)).channels.find(item => item.id === data.channelId && item.type === 0);
    if (!channel) throw new Problem(400, 'Choose a Discord text channel where Warband can post.');
    if (!channel.canPostGuide) throw new Problem(403, 'Give Warband Embed Links in the selected channel.');
  }
  await discordGuide().save(data.enabled ? data.channelId : '');
  return discordGuide().status();
}
const nextGuideUpdate = new Map();
function updatePublishedGuide() {
  if (!discordGuide() || Date.now() < (nextGuideUpdate.get(serverId()) || 0)) return;
  nextGuideUpdate.set(serverId(), Date.now() + 30000);
  const update = discordGuide().updatePublishedCopy().then(updated => {
    if (updated) console.info('Warband published the revised Discord guide.');
  }).catch(error => {
    if (error.status !== 409) console.warn('Warband could not update the existing Discord guide.', { status: error.status });
  });
  if (onVercel) waitUntil(update);
  else return update;
}
function field(value, min, max, label) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (clean.length < min || clean.length > max) throw new Problem(400, label + ' must have ' + min + '–' + max + ' characters.');
  return clean;
}
function checkRegion(region) {
  if (!Object.hasOwn(regions, region)) throw new Problem(400, 'Choose an Albion region.');
}
const albionId = value => typeof value === 'string' && /^[\w-]{5,60}$/.test(value);
async function findCharacter(region, name) {
  const result = await albion(region, 'search?q=' + encodeURIComponent(name));
  const row = Array.isArray(result?.players) && result.players.find(item =>
    typeof item?.Name === 'string' && item.Name.toLowerCase() === name.toLowerCase());
  if (!row || !albionId(row.Id)) throw new Problem(404, 'No exact Albion character found in that region.');
  return row;
}
async function guildFor(region, id) {
  const row = await albion(region, 'guilds/' + id);
  if (row?.Id !== id || typeof row.Name !== 'string' || !row.Name) {
    throw new Problem(502, 'Albion returned an unexpected guild response.');
  }
  return { id, name: row.Name };
}
async function rosterFor(ctx, summary = false) {
  const { albionGuild: savedGuild, region } = ctx.settings || {};
  if (!savedGuild) return { guild: null, members: [] };
  const avatarPrefix = ctx.scope + ':roster-avatar:';
  const rolePrefix = ctx.scope + ':expertise:';
  const [roster, links, avatars, selections] = await Promise.all([
    demo ? demoRoster.map(Name => ({ Id: 'demo-' + Name.toLowerCase(), Name })) :
      albion(region, 'guilds/' + savedGuild.id + '/members?warband_roster=' + Math.floor(Date.now() / 45000)),
    db.entries(ctx.characterPrefix),
    demo || summary ? [] : db.entries(avatarPrefix),
    db.entries(rolePrefix)
  ]);
  if (!Array.isArray(roster)) throw new Problem(502, 'Albion returned an unexpected roster.');
  const linked = new Map(links.filter(([, character]) => character?.region === region)
    .map(([key, character]) => [character.id, key.slice(ctx.characterPrefix.length)]));
  const members = [];
  const lookups = [];
  const cachedAvatars = new Map(avatars);
  const savedRoles = new Map(selections);
  const avatarWrites = [];
  function useAvatar(id, member, url) {
    const key = avatarPrefix + id;
    const cached = cachedAvatars.get(key);
    member.avatarUrl = url;
    if (!url || (cached?.url === url && cached.refreshAfter > Date.now())) return;
    const day = 86400000;
    avatarWrites.push(() => put(key, { url, refreshAfter: Date.now() + day }, Date.now() + 7 * day));
  }
  for (const row of roster) {
    if (!albionId(row?.Id) || typeof row.Name !== 'string') continue;
    const id = linked.get(row.Id);
    const roles = id ? savedRoles.get(rolePrefix + id) : null;
    const playRoles = Array.isArray(roles) ? roles.filter(name => ctx.availableRoles.includes(name)) : [];
    const member = { id: row.Id, name: row.Name, guildMaster: row.Id === savedGuild.master?.id,
      signedUp: Boolean(id), playRoles, avatarUrl: null, organizer: false };
    members.push(member);
    if (summary) continue;
    if (id === ctx.profile.id) {
      if (ctx.member.avatarUrl) useAvatar(id, member, ctx.member.avatarUrl);
      member.organizer = ctx.manager;
    }
    else if (!demo && snowflake(id)) {
      member.avatarUrl = cachedAvatars.get(avatarPrefix + id)?.url ?? null;
      lookups.push({ id, member });
    }
  }
  const deadline = Date.now() + 6000;
  async function refreshMember({ id, member }) {
    let account;
    try {
      account = await discord('/guilds/' + serverId() + '/members/' + id, bot);
    } catch (error) {
      if (error.upstreamStatus === 404) {
        member.avatarUrl = null;
        const key = avatarPrefix + id;
        if (cachedAvatars.has(key)) avatarWrites.push(() => remove(key));
      }
      throw error;
    }
    const url = discordAvatar(id, account);
    if (url) useAvatar(id, member, url);
    if (account?.user?.id !== id || account.pending || !Array.isArray(account.roles)) return;
    const held = ctx.member.allRoles.filter(role => role.id === serverId() || account.roles.includes(role.id));
    member.organizer = canOrganize(discordAdmin(id, ctx.member.ownerId, held), account.roles, ctx.organizerRole);
  }
  for (let i = 0; i < lookups.length && Date.now() < deadline; i += 8) {
    const batch = lookups.slice(i, i + 8);
    const results = await Promise.allSettled(batch.map(refreshMember));
    const retry = [];
    let wait = 250;
    results.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      const { status, upstreamStatus, retryAfterMs } = result.reason;
      if (status === 429) {
        wait = Math.max(wait, retryAfterMs ?? Infinity);
        retry.push(batch[index]);
      } else if (status === 502 && (!upstreamStatus || upstreamStatus >= 500)) {
        retry.push(batch[index]);
      }
    });
    if (!retry.length) continue;
    if (Date.now() + wait >= deadline) break;
    await delay(wait);
    const retried = await Promise.allSettled(retry.map(refreshMember));
    if (retried.some(result => result.status === 'rejected' && result.reason?.status === 429)) break;
  }
  await Promise.allSettled(avatarWrites.map(async write => write()));
  members.sort((a, b) => a.name.localeCompare(b.name));
  return { guild: { id: savedGuild.id, name: savedGuild.name }, region, members, organizerRoleName: organizerRoleName(ctx) };
}
const guestLink = (settings, character) => Boolean(settings?.albionGuild && settings.guestRoleId && character?.guest &&
  character.region === settings.region && !linkedToGuild(character, settings.region, settings.albionGuild.id));
async function guestRosterFor(ctx) {
  const { settings } = ctx;
  const guild = settings?.albionGuild;
  const region = settings?.region;
  if (!guild || !settings.guestRoleId) return { guests: true, region, members: [] };
  const prefix = ctx.scope + ':expertise:';
  const [links, roles, affiliations] = await Promise.all([db.entries(ctx.characterPrefix), db.entries(prefix), db.entries(affiliationPrefix(ctx.scope))]);
  const selections = new Map(roles);
  const cached = new Map(affiliations);
  const guests = links.filter(([, character]) => character?.guest && character.region === region);
  const due = guests.map(([, character]) => {
    const key = affiliationKey(ctx.scope, character);
    return { key, character, snapshot: cached.get(key) };
  }).filter(({ snapshot }) => affiliationDue(snapshot))
    .sort((a, b) => (a.snapshot?.checkedAt ?? 0) - (b.snapshot?.checkedAt ?? 0)).slice(0, 6);
  await Promise.all(due.map(async ({ key, character, snapshot }) => {
    cached.set(key, await refreshAffiliation(key, character, snapshot));
  }));
  const members = guests.map(([key, character]) => [key, { ...character, ...cached.get(affiliationKey(ctx.scope, character))?.character }])
    .filter(([, character]) => guestLink(settings, character))
    .map(([key, character]) => ({ id: character.id, name: character.name, guild: character.guild,
      avatarUrl: character.avatarUrl ?? null, playRoles: (selections.get(prefix + key.slice(ctx.characterPrefix.length)) ?? [])
        .filter(role => ctx.availableRoles.includes(role)) }));
  members.sort((a, b) => a.name.localeCompare(b.name));
  return { guests: true, region, members };
}
async function albionPlayer(region, id, { verifyGuild = false } = {}) {
  // Albion can serve stale guild data from the bare player URL. Share the fresh lookup within a short window.
  const revision = verifyGuild ? '?warband_guild_check=' + Math.floor(Date.now() / 60000) : '';
  const row = await albion(region, 'players/' + encodeURIComponent(id) + revision);
  if (row?.Id !== id || typeof row.Name !== 'string' || !row.Name) {
    throw new Problem(502, 'Albion returned an unexpected character response.');
  }
  return row;
}
async function characterFor(region, id, options) {
  const row = await albionPlayer(region, id, options);
  return { id, name: row.Name, guild: row.GuildName || '', guildId: row.GuildId || '', region };
}
const affiliationPrefix = scope => scope + ':albion-affiliation:';
const affiliationKey = (scope, character) => affiliationPrefix(scope) + character.region + ':' + character.id;
const affiliationDue = snapshot => Date.now() - (snapshot?.checkedAt ?? 0) >= 60000;
const affiliationLoads = new Map();
function saveAffiliation(key, snapshot) {
  return db.change(key, {}, Date.now() + 7 * 86400000, current => {
    if (snapshot.checkedAt >= (current.checkedAt ?? 0)) {
      current.checkedAt = snapshot.checkedAt;
      if (snapshot.character) current.character = snapshot.character;
    }
    return current;
  });
}
function refreshAffiliation(key, character, previous) {
  if (!affiliationLoads.has(key)) {
    const checkedAt = Date.now();
    const load = characterFor(character.region, character.id, { verifyGuild: true })
      .catch(() => previous?.character ?? null)
      .then(character => saveAffiliation(key, { checkedAt, character }))
      .finally(() => affiliationLoads.delete(key));
    affiliationLoads.set(key, load);
  }
  return affiliationLoads.get(key);
}
async function currentLinkedCharacter(scope, saved, refresh) {
  const key = affiliationKey(scope, saved);
  let snapshot = await get(key);
  if (refresh && affiliationDue(snapshot)) snapshot = await refreshAffiliation(key, saved, snapshot);
  return { ...saved, ...snapshot?.character };
}
const recentCombatLimit = 10;
const fameValue = value => Number.isFinite(value) && value >= 0 ? value : null;
const combatSlots = ['MainHand', 'OffHand', 'Head', 'Armor', 'Shoes', 'Cape', 'Bag', 'Mount', 'Food', 'Potion'];
function combatItem(item) {
  if (typeof item?.Type !== 'string' || !/^[A-Z0-9_]{1,100}(?:@[0-9])?$/.test(item.Type)) return null;
  const id = item.Type;
  return { id, name: itemCatalog.get(id.split('@')[0])?.[1] || id,
    quality: Number.isInteger(item.Quality) && item.Quality >= 1 && item.Quality <= 5 ? item.Quality : null,
    count: Number.isSafeInteger(item.Count) && item.Count > 0 ? item.Count : null };
}
function combatPlayer(player) {
  return { name: player.Name, itemPower: fameValue(player.AverageItemPower),
    guild: typeof player.GuildName === 'string' ? player.GuildName : '',
    allianceTag: typeof player.AllianceTag === 'string' ? player.AllianceTag : '',
    gear: combatSlots.flatMap(slot => {
      const item = combatItem(player.Equipment?.[slot]);
      return item ? [{ slot, ...item }] : [];
    }) };
}
function combatType(event) {
  const tag = value => typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : '';
  const type = tag(event.Type);
  const area = tag(event.KillArea);
  const category = tag(event.Category);
  const mode = area + '_' + category;
  if (/KNOCK_?DOWN/.test(type + '_' + mode)) return 'Knockdown';
  if (mode.includes('HELLGATE') || mode.includes('HELL_GATE')) {
    if (mode.includes('2V2') || mode.includes('2_V_2')) return '2v2 Hellgate';
    if (mode.includes('5V5') || mode.includes('5_V_5')) return '5v5 Hellgate';
    if (mode.includes('10V10') || mode.includes('10_V_10')) return '10v10 Hellgate';
    return 'Hellgate';
  }
  if (mode.includes('STALKER')) return 'Stalker';
  if (mode.includes('CORRUPTED')) return 'Corrupted Dungeon';
  if (mode.includes('DEPTHS')) return 'Depths';
  if (/(?:^|_)ZVZ(?:_|$)/.test(mode)) return 'ZvZ';
  if (/(?:^|_)GANK(?:_|$)/.test(mode)) return 'Gank';
  if (area.includes('ARENA')) return 'Arena';
  if (area.includes('MIST')) return 'Mists';
  if (area === 'OPEN_WORLD' && event.numberOfParticipants === 1 && event.groupMemberCount === 1) return 'Solo';
  if (area === 'OPEN_WORLD') return event.numberOfParticipants > 1 ? 'Group PvP' : 'Open-world PvP';
  return 'PvP';
}
async function combatEvent(character, id) {
  if (!/^[1-9]\d{0,14}$/.test(id || '')) throw new Problem(400, 'Choose a valid PvP event.');
  const event = await albion(character.region, 'events/' + id);
  if (String(event?.EventId) !== id || typeof event.Killer?.Name !== 'string' || typeof event.Victim?.Name !== 'string') {
    throw new Problem(502, 'Albion returned an unexpected PvP event.');
  }
  if (event.Killer.Id !== character.id && event.Victim.Id !== character.id) {
    throw new Problem(404, 'That event is unavailable for this character.');
  }
  const inventory = Array.isArray(event.Victim.Inventory) ?
    event.Victim.Inventory.slice(0, 300).map(combatItem).filter(Boolean) : null;
  const killer = combatPlayer(event.Killer);
  const victim = combatPlayer(event.Victim);
  const victimItems = [...victim.gear, ...(inventory ?? [])];
  const prices = await combatPrices(character.region, [...killer.gear, ...victimItems]);
  killer.gear = priceCombatItems(killer.gear, prices);
  victim.gear = priceCombatItems(victim.gear, prices);
  const pricedInventory = inventory === null ? null : priceCombatItems(inventory, prices);
  const type = combatType(event);
  const timestamp = typeof event.TimeStamp === 'string' ? Date.parse(event.TimeStamp) : NaN;
  return { killer: { ...killer, build: estimateSilver(killer.gear) },
    victim: { ...victim, build: estimateSilver(victim.gear) }, inventory: pricedInventory, type,
    timestamp: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    fame: fameValue(event.TotalVictimKillFame),
    silverLost: type !== 'Knockdown' && type !== 'Arena' && pricedInventory !== null
      ? estimateSilver([...victim.gear, ...pricedInventory]) : null };
}
async function albionProfile(ctx, query) {
  const view = query.get('view') ?? 'overview';
  if (!['overview', 'kills', 'deaths', 'event'].includes(view)) throw new Problem(400, 'Choose an Albion profile tab.');
  if (demo) throw new Problem(404, 'Albion character details are unavailable in demo mode.');
  const memberId = query.get('member');
  let character = ctx.character;
  let player;
  if (memberId !== null) {
    if (!albionId(memberId)) throw new Problem(400, 'Choose a valid Albion guild member.');
    const { albionGuild: guild, region } = ctx.settings || {};
    if (!guild) throw new Problem(404, 'No Albion guild is configured.');
    const guests = query.get('directory') === 'guests';
    if (guests && !(await db.entries(ctx.characterPrefix)).some(([, link]) => link.id === memberId && guestLink(ctx.settings, link))) {
      throw new Problem(404, 'This guest is not listed in Warband.');
    }
    player = await albionPlayer(region, memberId, { verifyGuild: true });
    if (guests ? player.GuildId === guild.id : player.GuildId !== guild.id) {
      throw new Problem(404, 'This character is not in the selected roster.');
    }
    character = { id: memberId, region };
  }
  if (!character) throw new Problem(404, 'Link an Albion character to view their profile.');
  const { region, id } = character;
  if (view === 'event') return combatEvent(character, query.get('id'));
  if (view === 'overview') {
    player ??= await albionPlayer(region, id);
    const lifetime = player.LifetimeStatistics;
    const earned = {
      kill: fameValue(player.KillFame), mob: fameValue(lifetime?.PvE?.Total),
      gathering: fameValue(lifetime?.Gathering?.All?.Total), crafting: fameValue(lifetime?.Crafting?.Total),
      fishing: fameValue(lifetime?.FishingFame), farming: fameValue(lifetime?.FarmingFame)
    };
    const reported = Object.values(earned).filter(value => value !== null);
    const officialTotal = fameValue(player.TotalFame) ?? fameValue(lifetime?.TotalFame);
    const total = officialTotal ?? (reported.length ? reported.reduce((sum, value) => sum + value, 0) : null);
    return { name: player.Name, guild: player.GuildName || '', alliance: player.AllianceName || '', region,
      fame: { total, ...earned, death: fameValue(player.DeathFame) },
      fameTotalPartial: officialTotal === null && reported.length > 0 && reported.length < Object.keys(earned).length };
  }
  const rows = await albion(region, 'players/' + encodeURIComponent(id) + '/' + view + '?limit=' + recentCombatLimit +
    '&offset=0&warband_combat=' + Math.floor(Date.now() / 10000));
  if (!Array.isArray(rows)) throw new Problem(502, 'Albion returned unexpected combat history.');
  return { limit: recentCombatLimit, events: rows.flatMap(event => {
    const opponent = view === 'kills' ? event?.Victim : event?.Killer;
    const timestamp = typeof event?.TimeStamp === 'string' ? Date.parse(event.TimeStamp) : NaN;
    if (!Number.isFinite(timestamp) || typeof opponent?.Name !== 'string' || !opponent.Name) return [];
    const eventId = Number.isSafeInteger(event.EventId) && event.EventId > 0 ? String(event.EventId) : null;
    return [{ id: eventId, opponent: opponent.Name, timestamp: new Date(timestamp).toISOString(), fame: fameValue(event.TotalVictimKillFame) }];
  }).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, recentCombatLimit) };
}
const partiesFor = ctx => get(ctx.scope + ':parties', []);
function editParties(ctx, fn) {
  return db.change(ctx.scope + ':parties', [], ctx.profile.expires, fn);
}
function findParty(parties, id) {
  const item = parties.find(party => party.id === id);
  if (!item) throw new Problem(404, 'Party not found.');
  return item;
}
const signupRef = (party, signup) => signup.claimId ?? hash(party.id + ':' + signup.user + ':' + signup.role).slice(0, 22);
function visible(party, ctx) {
  const { nonce, postingAt, deletingAt, gearReminder, threadActivity, announcementVersion, waitlist = [], rosterChanged, channelId, guildId: target, region, hostId, signups, ...fields } = party;
  return { ...fields, canPingRoster: Boolean(ctx.manager && canPingRoster(party)),
    waitlist: waitlist.map(entry => ({ name: entry.name, role: entry.role, offered: Boolean(entry.offered), mine: entry.user === ctx.profile.id,
      ...(ctx.manager ? { signupId: entry.id } : {}) })),
    signups: signups.map(signup => ({ name: signup.name, role: signup.role, mine: signup.user === ctx.profile.id,
      ...(ctx.manager ? { signupId: signupRef(party, signup) } : {}) })) };
}
const canJoinParty = (ctx, party, character) => !party.guildOnly ||
  (!ctx.guest && linkedToGuild(character, party.region, party.guildId));
const canViewParty = (ctx, party, character) => ctx.manager || canJoinParty(ctx, party, character);
const restrictedPartyMessage = party => 'This party is exclusive to ' + (party.guild || 'the configured Albion guild') + ' members.';
async function partyViewerCharacter(ctx, parties) {
  if (demo || ctx.manager || !parties.some(party => party.guildOnly && canViewParty(ctx, party, ctx.character))) return ctx.character;
  return characterFor(ctx.character.region, ctx.character.id, { verifyGuild: true });
}
const types = ['Roads of Avalon', 'PvE', 'PvP', 'Gathering', 'Faction Warfare', 'Other'];
function recommendedBuild(input) {
  const build = {};
  for (const slot of buildSlots) {
    const selected = input?.[slot];
    if (!selected) continue;
    const item = itemCatalog.get(selected.id);
    if (!item || item[2] !== slot || !item[3].includes(selected.enchantment) ||
        !Number.isInteger(selected.quality) || selected.quality < 1 || selected.quality > item[4]) {
      throw new Problem(400, 'Choose a valid Albion item and variant for ' + slot + '.');
    }
    build[slot] = { id: item[0], name: item[1], enchantment: selected.enchantment, quality: selected.quality };
  }
  if (build.offhand && itemCatalog.get(build.weapon?.id)?.[5]) {
    throw new Problem(400, 'A two-handed weapon cannot use an offhand.');
  }
  return Object.keys(build).length ? build : undefined;
}
function partyDetails(data) {
  const title = field(data.title, 2, 80, 'Party name');
  const zone = field(data.zone, 1, 80, 'Meeting location');
  const summary = field(data.summary, 0, 420, 'Party notes');
  if (!types.includes(data.type)) throw new Problem(400, 'Choose an activity.');
  if (!Array.isArray(data.roles) || !data.roles.length || data.roles.length > 20) throw new Problem(400, 'Add between 1 and 20 roles.');
  const roles = data.roles.map(role => {
    const name = field(role?.name, 1, 36, 'Role name');
    if (!Number.isInteger(role.count) || role.count < 1 || role.count > 20) throw new Problem(400, 'Each role needs 1 to 20 slots.');
    const build = recommendedBuild(role.build);
    return { name, count: role.count, ...(build ? { build } : {}) };
  });
  if (new Set(roles.map(role => role.name.toLowerCase())).size !== roles.length) throw new Problem(400, 'Give each role a different name.');
  if (roles.reduce((sum, role) => sum + role.count, 0) > 20) throw new Problem(400, 'A party can have up to 20 slots.');
  if (data.waitUntilFull !== undefined && typeof data.waitUntilFull !== 'boolean') {
    throw new Problem(400, 'Choose whether to wait until all slots are filled.');
  }
  return { title, zone, summary, type: data.type, roles, guildOnly: data.guildOnly === true, waitUntilFull: data.waitUntilFull === true };
}
function partySchedule(data, current) {
  if (data.waitUntilFull === true) return null;
  const when = typeof data.starts === 'string' ? Date.parse(data.starts) : NaN;
  if (!Number.isFinite(when) || (when <= Date.now() && when !== Date.parse(current?.starts)) ||
      when > Date.now() + 366 * 86400000) throw new Problem(400, 'Choose a future time within the next year.');
  return new Date(when).toISOString();
}
const partyClosed = party => party.cancelled || party.finished || party.startedAt || (!party.waitUntilFull && Date.parse(party.starts) <= Date.now());
const mentionChoices = ctx => demo ? demoRoles : ctx.member.allRoles
  .filter(role => role.id !== serverId() && !role.managed).map(({ id, name }) => ({ id, name }))
  .sort((a, b) => a.name.localeCompare(b.name));
function announcementOptions(data, ctx, previous = {}) {
  const announcementThread = data.announcementThread ?? (previous.announcementThread === true);
  const mentionRoleIds = data.mentionRoleIds ?? previous.mentionRoleIds ??
    (previous.mentionRoleId ? [previous.mentionRoleId] : []);
  if (typeof announcementThread !== 'boolean') throw new Problem(400, 'Choose whether to use Discord threads.');
  const allowed = new Set(mentionChoices(ctx).map(role => role.id));
  if (!Array.isArray(mentionRoleIds) || mentionRoleIds.length > 50 || mentionRoleIds.some(id => !allowed.has(id))) {
    throw new Problem(400, 'Choose up to 50 available Discord roles to mention.');
  }
  return { announcementThread, mentionRoleIds: [...new Set(mentionRoleIds)].sort() };
}
function partyData(data, ctx) {
  const settings = ctx.settings;
  if (!settings) throw new Problem(409, 'Save a Discord channel in Settings first.');
  const details = partyDetails(data);
  const starts = partySchedule(data);
  if (details.guildOnly && !settings.albionGuild) throw new Problem(400, 'Set an Albion guild in Settings first.');
  const delivery = announcementOptions(data, ctx, settings);
  if (delivery.announcementThread && settings.channelType === 5) {
    throw new Problem(400, 'Choose a Discord text channel in Settings for thread announcements.');
  }
  if (typeof data.nonce !== 'string' || !/^[\w-]{12,24}$/.test(data.nonce)) throw new Problem(400, 'Invalid party submission.');
  return { id: key(), nonce: data.nonce, ...details, starts,
    signups: [], host: ctx.character?.name || ctx.profile.name, hostId: ctx.profile.id, channel: settings.channel,
    channelId: settings.channelId, guildId: settings.albionGuild?.id,
    guild: settings.albionGuild?.name, region: settings.region, announcement: demo ? 'demo' : 'pending',
    ...delivery };
}
async function publishParty(ctx, data) {
  const draft = partyData(data, ctx);
  const saved = await editParties(ctx, parties => {
    const duplicate = parties.find(party => party.hostId === draft.hostId && party.nonce === draft.nonce);
    if (duplicate) return duplicate;
    if (parties.length >= 1000) throw new Problem(409, 'The board has reached its party limit.');
    parties.unshift(draft);
    return draft;
  });
  const created = saved.id === draft.id;
  if (!demo && created) await syncAnnouncement(ctx, saved.id);
  return { party: findParty(await partiesFor(ctx), saved.id), created };
}

const discordText = text => text.replace(/[\\*_~|>\[\]<>`]/g, '\\$&').replace(/@/g, '@\u200b').replace(/[\r\n]/g, ' ');
const deletionBusy = party => Date.now() - (party.deletingAt || 0) < 40000;
const announcementBusy = party => deletionBusy(party) || Date.now() - (party.postingAt || 0) < 40000;
const announcementMessageId = party => {
  const id = party.messageId || party.messageUrl?.split('/').at(-1);
  return snowflake(id) ? id : '';
};
const partyFull = party => party.signups.length === party.roles.reduce((total, role) => total + role.count, 0);
const rosterPingUsers = party => [...new Set(party.signups.map(entry => entry.user).filter(snowflake))];
const partyThread = party => snowflake(party.threadId) && party.threadId !== party.channelId && announcementMessageId(party);
function canPingRoster(party) {
  return !party.finished && !party.cancelled && (demo ? party.announcementThread && party.signups.length :
    partyThread(party) && rosterPingUsers(party).length);
}
const roleClaims = (party, role) => party.signups.filter(entry => entry.role === role).length;
const roleOffers = (party, role) => (party.waitlist || []).filter(entry => entry.role === role && entry.offered).length;
const partyPerson = (user, name) => snowflake(user) ? '<@' + user + '>' : discordText(name || 'Member');
function partyActivity(party, text, users = []) {
  if (demo || (!party.threadId && !party.announcementThread)) return;
  party.threadActivity ??= [];
  party.threadActivity.push({ id: key(), text, users });
}
async function deliverPartyActivity(ctx, id) {
  if (demo) return;
  try {
    await withRecordLock(db, ctx.scope + ':party-activity:' + id, 'Party activity is already syncing.', async () => {
      for (let i = 0; i < 20; i++) {
        const party = (await partiesFor(ctx)).find(item => item.id === id);
        const event = party?.threadActivity?.[0];
        if (!event || !partyThread(party) || deletionBusy(party)) return;
        await discord('/channels/' + party.threadId + '/messages', bot, {
          ...(event.users.length ? { content: event.users.map(user => '<@' + user + '>').join(' ') } : {}),
          embeds: [{ color: 0xeab77b, description: event.text }],
          allowed_mentions: { parse: [], users: event.users }, nonce: event.id, enforce_nonce: true
        });
        await editParties(ctx, parties => {
          const item = parties.find(party => party.id === id);
          if (item) item.threadActivity = (item.threadActivity || []).filter(entry => entry.id !== event.id);
        });
      }
    });
  } catch (error) {
    if (error.status !== 409) console.warn('Party thread activity delivery deferred.', { status: error.status });
  }
}
async function signupCharacter(ctx, party) {
  if (!demo && (!ctx.character || onboardingStep(ctx))) throw new Problem(409, 'Link your Albion character and save your Warband roles first.');
  if (ctx.availableRoles.length && !ctx.expertise.length) throw new Problem(409, 'Choose your expertise roles before claiming a slot.');
  let character = ctx.character;
  if (party.guildOnly || (!demo && ctx.settings?.albionGuild && !ctx.guest)) {
    if (!character) throw new Problem(403, 'Link your Albion character before claiming a slot.');
    if (!demo) character = await characterFor(character.region, character.id);
    if (!canJoinParty(ctx, party, character)) throw new Problem(403, restrictedPartyMessage(party));
    if (!demo && ctx.settings?.albionGuild && character.guildId !== ctx.settings.albionGuild.id) {
      throw new Problem(403, guildMembershipError(ctx.settings.albionGuild));
    }
  }
  return character;
}
async function offerWaitlistSlots(ctx, id) {
  try {
    await withRecordLock(db, ctx.scope + ':party-waitlist:' + id, 'Waitlist is already being updated.', async () => {
      for (let i = 0; i < 20; i++) {
        const party = (await partiesFor(ctx)).find(item => item.id === id);
        if (!party || partyClosed(party) || deletionBusy(party)) return;
        const entry = (party.waitlist || []).find(entry => !entry.offered && party.roles[entry.role] &&
          roleClaims(party, entry.role) + roleOffers(party, entry.role) < party.roles[entry.role].count);
        if (!entry) return;
        let eligible = true;
        try {
          if (!demo) await signupCharacter(await discordPlayerContext({ id: entry.user, name: entry.name }), party);
        } catch (error) {
          if (![403, 404, 409].includes(error.status)) return;
          eligible = false;
        }
        await editParties(ctx, parties => {
          const item = findParty(parties, id);
          if (partyClosed(item) || deletionBusy(item)) return;
          const waiting = (item.waitlist || []).find(row => row.id === entry.id && !row.offered);
          if (!waiting || item.roles[waiting.role]?.name !== party.roles[entry.role].name) return;
          if (!eligible) {
            item.waitlist = item.waitlist.filter(row => row.id !== entry.id);
            partyActivity(item, partyPerson(entry.user, entry.name) + ' was removed from the waitlist because they no longer meet the party requirements.');
          } else if (roleClaims(item, waiting.role) + roleOffers(item, waiting.role) < item.roles[waiting.role].count) {
            waiting.offered = true;
            const role = item.roles[waiting.role];
            partyActivity(item, '**A slot is available!** ' + partyPerson(waiting.user, waiting.name) + ', your **' +
              discordText(role.name) + '** slot is reserved. Tap that role to accept, or tap it again after joining to leave. ' +
              'Use **Leave party** to decline the offer.', [waiting.user]);
          }
          item.rosterChanged = true;
        });
      }
    });
  } catch (error) {
    if (error.status !== 409) console.warn('Party waitlist processing deferred.', { status: error.status });
  }
}
async function settleParty(ctx, id) {
  await offerWaitlistSlots(ctx, id);
  const party = (await partiesFor(ctx)).find(item => item.id === id);
  if (!demo && party && announcementMessageId(party)) await syncAnnouncement(ctx, id, true, true);
  await deliverPartyActivity(ctx, id);
}
function queuePartyMaintenance(ctx, parties) {
  if (demo) return;
  const pending = parties.filter(party => party.threadActivity?.length ||
    (!party.finished && !party.cancelled && party.announcement === 'sent' && announcementMessageId(party) && party.announcementVersion !== 2) || (!partyClosed(party) &&
    party.waitlist?.some(entry => !entry.offered && party.roles[entry.role] &&
      roleClaims(party, entry.role) + roleOffers(party, entry.role) < party.roles[entry.role].count))).slice(0, 2);
  if (!pending.length) return;
  const work = Promise.allSettled(pending.map(party => settleParty(ctx, party.id)));
  if (onVercel) waitUntil(work);
  else return work;
}
function sendRosterPing(party, nonce) {
  const users = rosterPingUsers(party);
  const text = partyFull(party) ? '**Party full!** Gear up with your role’s recommended build and get ready for the run.' :
    '**Party check-in.** Check your role’s recommended build and get ready for the run.';
  return discord('/channels/' + party.threadId + '/messages', bot, {
    content: users.map(id => '<@' + id + '>').join(' ') + '\n\n' + text,
    allowed_mentions: { parse: [], users },
    nonce, enforce_nonce: true
  });
}
function queueGearReminder(party, wasFull) {
  if (!demo && !wasFull && partyFull(party) && (party.announcementThread || party.threadId)) {
    party.gearReminder ??= { status: 'pending' };
  }
}
async function deliverGearReminder(ctx, id) {
  const started = Date.now();
  const party = await editParties(ctx, parties => {
    const item = parties.find(party => party.id === id);
    if (!item?.gearReminder || item.gearReminder.status === 'sent' || partyClosed(item) || deletionBusy(item) ||
        started - (item.gearReminder.started || 0) < 40000 ||
        !partyFull(item) || !canPingRoster(item)) return null;
    item.gearReminder.started = started;
    return item;
  });
  if (!party) return;
  let sent = false;
  try {
    await sendRosterPing(party, 'g:' + id);
    sent = true;
  } catch (error) {
    console.warn('Discord gear reminder delivery failed:', error.upstreamStatus || error.status || 'unknown');
  }
  await editParties(ctx, parties => {
    const item = parties.find(party => party.id === id);
    if (item?.gearReminder?.started === started) item.gearReminder = { status: sent ? 'sent' : 'pending' };
  });
}
function announcementCard(party) {
  const stamp = Math.floor(Date.parse(party.starts) / 1000);
  const signupLines = party.roles.map((role, index) => {
    const signups = party.signups.filter(entry => entry.role === index);
    const names = signups.map(entry => snowflake(entry.user) ? '<@' + entry.user + '>' : discordText(entry.name || 'Member'));
    const waiting = (party.waitlist || []).filter(entry => entry.role === index);
    return discordText(role.name) + ' - ' + signups.length + '/' + role.count +
      (names.length ? ' | ' + names.join(', ') : '') + (waiting.length ? '\n↳ Waitlist · ' + waiting.map(entry =>
        partyPerson(entry.user, entry.name) + (entry.offered ? ' (slot offered)' : '')).join(', ') : '');
  });
  const status = party.cancelled ? '**Cancelled**' : party.finished ? '**Finished**' : party.startedAt ? '**Party started · Roster locked**' : '';
  const filled = partyFull(party);
  const schedule = party.waitUntilFull ? (status ? 'No scheduled start' : filled ? '**Ready · All slots filled**' : '**Waiting for all slots to fill**') :
    '<t:' + stamp + ':F> (<t:' + stamp + ':R>)';
  const link = workspaceUrl(party.id).href;
  return {
    author: { name: 'ALBION ONLINE · WARBAND' },
    title: party.title,
    url: link,
    color: 0xda2948,
    description: [
      party.type + ' · ' + discordText(party.zone) + '\nOrganized by ' + discordText(party.host || 'Warband'),
      party.summary && discordText(party.summary),
      schedule,
      status,
      signupLines.join('\n'),
      interactionKey && !partyClosed(party) && 'Tap a role to join, or queue when it is full. Tap it again to leave your claim or waitlist. Accept an offered slot by tapping its role. **Leave party** clears your claim and waitlist.',
      party.guildOnly && 'Guild only · ' + discordText(party.guild),
      '[Open party in Warband](' + link + ')'
    ].filter(Boolean).join('\n\n'),
    ...(secure ? { image: { url: new URL('/stronghold.webp', base).href } } : {})
  };
}
function signupButtons(party) {
  const disabled = Boolean(partyClosed(party));
  const rows = Array.from({ length: Math.ceil(party.roles.length / 5) }, (_, row) => ({
    type: 1,
    components: party.roles.slice(row * 5, row * 5 + 5).map((role, index) => ({
      type: 2, style: 2, label: role.name, emoji: { name: roleEmoji[row * 5 + index] },
      custom_id: 'wb:' + party.id + ':' + hash(role.name).slice(0, 20),
      disabled
    }))
  }));
  const controls = [
    { type: 2, style: 4, label: 'Leave party', custom_id: 'wb:' + party.id + ':leave', disabled },
    { type: 2, style: 3, label: 'Start party', custom_id: 'wb:' + party.id + ':start',
      disabled: Boolean(party.startedAt || party.finished || party.cancelled) }
  ];
  for (const control of controls) {
    if (rows.at(-1)?.components.length < 5) rows.at(-1).components.push(control);
    else rows.push({ type: 1, components: [control] });
  }
  return rows;
}
async function announce(ctx, id, allowClosed = false, refresh = false) {
  const party = await editParties(ctx, parties => {
    const item = findParty(parties, id);
    if (refresh && !announcementMessageId(item)) return null;
    if (!allowClosed && partyClosed(item) &&
        !item.messageId && !item.messageUrl) throw new Problem(409, 'This party has closed.');
    if ((item.announcement === 'sent' && !item.rosterChanged && item.announcementVersion === 2) || announcementBusy(item)) return null;
    Object.assign(item, { announcement: 'pending', postingAt: Date.now(), deliveryError: null, rosterChanged: false });
    return item;
  });
  if (!party) return;
  let result;
  try {
    let destination = party.threadId || party.channelId;
    const messageId = announcementMessageId(party);
    if (party.announcementThread && !party.threadId && !messageId) {
      const thread = await discord('/channels/' + party.channelId + '/threads', bot, { name: party.title, type: 11 });
      destination = thread.id;
      await editParties(ctx, parties => { findParty(parties, id).threadId = destination; });
    }
    const allowed = new Set(messageId ? [] : mentionChoices(ctx).map(role => role.id));
    const mentions = (party.mentionRoleIds ?? [party.mentionRoleId]).filter(id => snowflake(id) && allowed.has(id));
    const message = await discord('/channels/' + destination + '/messages' + (messageId ? '/' + messageId : ''), bot, {
      content: mentions.map(id => '<@&' + id + '>').join(' '),
      embeds: [announcementCard(party)],
      allowed_mentions: { parse: [], roles: mentions, users: [] }, flags: 0,
      ...(interactionKey ? { components: signupButtons(party) } : {}),
      ...(messageId ? {} : { nonce: id, enforce_nonce: true })
    }, messageId ? 'PATCH' : 'POST');
    result = { announcement: 'sent', announcementVersion: 2, messageId: message.id,
      messageUrl: 'https://discord.com/channels/' + serverId() + '/' + destination + '/' + message.id };
  } catch (error) {
    result = { announcement: 'failed', deliveryError: error instanceof Problem ? error.message : 'Discord delivery could not be confirmed.' };
  }
  const needsRefresh = await editParties(ctx, parties => {
    const current = findParty(parties, id);
    Object.assign(current, result, { postingAt: null });
    return result.announcement === 'sent' && current.rosterChanged;
  });
  return needsRefresh;
}
async function syncAnnouncement(ctx, id, allowClosed = false, refresh = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!await announce(ctx, id, allowClosed, refresh)) break;
  }
  const party = (await partiesFor(ctx)).find(party => party.id === id);
  if (party?.gearReminder?.status === 'pending' && partyFull(party) && canPingRoster(party) && !partyClosed(party)) {
    await deliverGearReminder(ctx, id).catch(() => console.warn('Discord gear reminder state could not be saved.'));
  }
}
async function savePartyEdit(ctx, data) {
  const details = partyDetails(data);
  await editParties(ctx, parties => {
    const party = findParty(parties, data.id);
    if (party.finished || party.cancelled || party.startedAt) throw new Problem(409, 'This party has closed.');
    if (announcementBusy(party)) throw new Problem(409, 'The announcement is updating. Try again shortly.');
    const starts = partySchedule(data, party);
    if ((party.signups.length || party.waitlist?.length) && details.guildOnly !== party.guildOnly) {
      throw new Problem(409, 'Guild eligibility can only change before members sign up.');
    }
    const guild = ctx.settings?.albionGuild;
    if (details.guildOnly && !party.guildId && !guild) throw new Problem(400, 'Set an Albion guild in Settings first.');
    const signups = party.signups.map(entry => {
      const previous = party.roles[entry.role]?.name.toLowerCase();
      const role = details.roles.findIndex(item => item.name.toLowerCase() === previous);
      if (role < 0) throw new Problem(409, 'Keep any role that already has signups.');
      return { ...entry, role };
    });
    const waitlist = (party.waitlist || []).map(entry => {
      const name = party.roles[entry.role]?.name.toLowerCase();
      const role = details.roles.findIndex(item => item.name.toLowerCase() === name);
      if (role < 0) throw new Problem(409, 'Keep any role that has a waitlist.');
      return { ...entry, role };
    });
    if (details.roles.some((role, i) => signups.filter(entry => entry.role === i).length > role.count)) {
      throw new Problem(409, 'Keep enough slots for existing signups.');
    }
    if (details.roles.some((role, i) => signups.filter(entry => entry.role === i).length +
        waitlist.filter(entry => entry.role === i && entry.offered).length > role.count)) {
      throw new Problem(409, 'Keep enough slots for existing offers.');
    }
    const delivery = party.messageId || party.messageUrl || party.threadId ? {} : announcementOptions(data, ctx, party);
    if (delivery.announcementThread && party.channelId === ctx.settings?.channelId && ctx.settings.channelType === 5) {
      throw new Problem(400, 'This party’s announcement channel must be a Discord text channel to create a thread.');
    }
    const wasFull = partyFull(party);
    Object.assign(party, details, delivery, { starts, signups, waitlist, announcement: demo ? 'demo' : 'pending',
      ...(details.guildOnly && !party.guildId ? { guildId: guild.id, guild: guild.name, region: ctx.settings.region } : {}) });
    queueGearReminder(party, wasFull);
  });
  if (!demo) await syncAnnouncement(ctx, data.id, true);
  await settleParty(ctx, data.id);
  return findParty(await partiesFor(ctx), data.id);
}
async function deleteParty(ctx, id) {
  const party = await editParties(ctx, parties => {
    const item = findParty(parties, id);
    if (announcementBusy(item)) throw new Problem(409, 'The announcement is being updated. Try again shortly.');
    if (demo || !item.threadId) {
      parties.splice(parties.indexOf(item), 1);
      return null;
    }
    if (!snowflake(item.threadId) || item.threadId === item.channelId) {
      throw new Problem(409, 'The saved Discord thread ID is invalid. The party was kept.');
    }
    item.deletingAt = Date.now();
    return item;
  });
  if (!party) return null;
  try {
    await discord('/channels/' + party.threadId, bot, undefined, 'DELETE').catch(error => {
      if (error.upstreamStatus === 404) return;
      if (error.upstreamStatus === 403) {
        throw new Problem(403, 'Discord denied thread deletion. Give the Warband bot Manage Threads in the announcement channel and try again.');
      }
      throw error;
    });
    await editParties(ctx, parties => {
      parties.splice(parties.indexOf(findParty(parties, id)), 1);
    });
  } catch (error) {
    await editParties(ctx, parties => {
      const item = parties.find(entry => entry.id === id);
      if (item?.deletingAt === party.deletingAt) delete item.deletingAt;
    });
    throw error;
  }
  return null;
}
async function partyAction(ctx, { id, action, role, signupId }, discordSignup, expectedRoleKey, actor = ctx) {
  if (!['join', 'leave', 'waitlist', 'leave-waitlist', 'remove-waitlist', 'remove-signup', 'start', 'cancel', 'retry', 'finish', 'delete', 'ping'].includes(action)) throw new Problem(400, 'Choose a party action.');
  if (!['join', 'leave', 'waitlist', 'leave-waitlist'].includes(action)) requireManager(ctx);
  if (['remove-signup', 'remove-waitlist'].includes(action) && (typeof signupId !== 'string' || !/^[\w-]{22}$/.test(signupId))) {
    throw new Problem(400, 'Choose the signup to remove.');
  }
  const current = findParty(await partiesFor(ctx), id);
  if (!canViewParty(ctx, current, ctx.character)) throw new Problem(403, restrictedPartyMessage(current));
  const actorName = partyPerson(actor.profile.id, actor.character?.name || actor.profile.name);
  function checkDiscordAnnouncement(party) {
    if (discordSignup && (announcementMessageId(party) !== discordSignup.messageId ||
        (party.threadId || party.channelId) !== discordSignup.channelId ||
        (action === 'join' && hash(party.roles[role]?.name || '').slice(0, 20) !== discordSignup.roleKey))) {
      throw new Problem(409, 'This party button is out of date.');
    }
  }
  checkDiscordAnnouncement(current);
  if (action === 'ping') {
    if (deletionBusy(current) || !canPingRoster(current)) {
      throw new Problem(409, 'This party needs a Discord thread and at least one signup to ping its roster.');
    }
    await throttle(ctx.scope + ':party-ping:' + id, 1);
    if (!demo) await sendRosterPing(current, key());
    return current;
  }
  if (action === 'retry') {
    await throttle('publish:' + ctx.profile.id, 12);
    if (!demo) await syncAnnouncement(ctx, id, true);
    await settleParty(ctx, id);
    return findParty(await partiesFor(ctx), id);
  }
  if (action === 'delete') return deleteParty(ctx, id);
  if (['start', 'cancel', 'finish'].includes(action)) {
    const updated = await editParties(ctx, parties => {
      const item = findParty(parties, id);
      if (announcementBusy(item)) throw new Problem(409, 'The announcement is posting. Try again shortly.');
      if (item.cancelled || item.finished) throw new Problem(409, 'This party is already closed.');
      checkDiscordAnnouncement(item);
      if (action === 'start') {
        if (item.startedAt) throw new Problem(409, 'This party has already started.');
        if (!item.signups.length) throw new Problem(409, 'The party needs at least one signup before starting.');
        item.startedAt = new Date().toISOString();
      }
      if (action === 'cancel') item.cancelled = true;
      if (action === 'finish') item.finished = true;
      partyActivity(item, actorName + (action === 'start' ? ' **started the party**. The roster is locked.' :
        action === 'finish' ? ' **finished the party**.' : ' **cancelled the party**.'));
      item.rosterChanged = true;
      return item;
    });
    if (updated) await settleParty(ctx, id);
    if (discordSignup) return 'Party started. The roster is locked.';
    return updated && findParty(await partiesFor(ctx), id);
  }
  if (expectedRoleKey && hash(current.roles[role]?.name || '').slice(0, 20) !== expectedRoleKey) {
    throw new Problem(409, 'The party role changed. Choose it again from the suggestions.');
  }
  const needsCharacter = action === 'join' || action === 'waitlist';
  const character = needsCharacter ? await signupCharacter(ctx, current) : ctx.character;
  const { updated, result } = await editParties(ctx, parties => {
    const item = findParty(parties, id);
    checkDiscordAnnouncement(item);
    if (!canViewParty(ctx, item, character)) throw new Problem(403, restrictedPartyMessage(item));
    if (deletionBusy(item)) throw new Problem(409, 'This party is being deleted.');
    if (partyClosed(item)) throw new Problem(409, 'Signups are closed for this party.');
    if (needsCharacter && (item.guildOnly !== current.guildOnly || item.guildId !== current.guildId || item.region !== current.region ||
        item.roles[role]?.name !== current.roles[role]?.name)) throw new Problem(409, 'The party changed. Try again.');
    const wasFull = partyFull(item);
    item.waitlist ??= [];
    const waiting = item.waitlist.find(entry => entry.user === ctx.profile.id);
    if (action === 'leave-waitlist' || action === 'remove-waitlist') {
      const entry = action === 'remove-waitlist' ? item.waitlist.find(entry => entry.id === signupId) : waiting;
      if (!entry) throw new Problem(409, 'This waitlist entry has changed. Open the current roster and try again.');
      item.waitlist = item.waitlist.filter(row => row !== entry);
      partyActivity(item, partyPerson(entry.user, entry.name) + ' left the **' + discordText(item.roles[entry.role].name) +
        '** waitlist' + (action === 'remove-waitlist' ? ' · removed by ' + actorName : '') + '.');
      item.rosterChanged = true;
      return { updated: item, result: 'Waitlist entry removed.' };
    }
    const previous = action === 'remove-signup'
      ? item.signups.find(entry => signupRef(item, entry) === signupId)
      : item.signups.find(entry => entry.user === ctx.profile.id);
    if (action === 'remove-signup' && !previous) throw new Problem(409, 'This signup has changed. Open the current roster and try again.');
    if (discordSignup && action === 'leave' && !previous && !waiting) throw new Problem(409, 'You do not have a slot or waitlist entry in this party.');
    const signups = item.signups.filter(entry => entry !== previous);
    const claimed = action === 'join' && !(discordSignup && previous?.role === role);
    const queuedToggle = discordSignup && claimed && waiting?.role === role && !waiting.offered;
    const occupied = Number.isInteger(role) && item.roles[role] &&
      signups.filter(entry => entry.role === role).length + item.waitlist.filter(entry => entry.role === role && entry.offered && entry !== waiting).length >= item.roles[role].count;
    if (queuedToggle || action === 'waitlist' || (discordSignup && claimed && occupied)) {
      if (!Number.isInteger(role) || !item.roles[role]) throw new Problem(400, 'Choose a party role.');
      if (previous?.role === role) throw new Problem(409, 'You already have a slot in that role.');
      if (queuedToggle) {
        item.waitlist = item.waitlist.filter(entry => entry !== waiting);
        partyActivity(item, actorName + ' left the **' + discordText(item.roles[role].name) + '** waitlist.');
      } else {
        if (!occupied && !item.waitlist.some(entry => entry.role === role)) throw new Problem(409, 'A slot is available. Claim it directly.');
        if (waiting?.role === role) return { updated: item, result: 'You are already on this waitlist.' };
        if (!waiting && item.waitlist.length >= 20) throw new Problem(409, 'This party already has 20 players on its waitlist.');
        item.waitlist = item.waitlist.filter(entry => entry !== waiting);
        item.waitlist.push({ id: key(), role, user: ctx.profile.id, name: character?.name || ctx.profile.name, offered: false });
        partyActivity(item, actorName + ' joined the **' + discordText(item.roles[role].name) + '** waitlist.');
      }
      item.rosterChanged = true;
      return { updated: item, result: queuedToggle ? 'You left the waitlist.' : 'Added to the ' + item.roles[role].name + ' waitlist.' };
    }
    if (claimed) {
      if (!Number.isInteger(role) || !item.roles[role]) throw new Problem(400, 'Choose a party role.');
      if (occupied) throw new Problem(409, 'That role is full. Join its waitlist.');
      if (item.waitlist.some(entry => entry.role === role && entry !== waiting) && !(waiting?.role === role && waiting.offered)) {
        throw new Problem(409, 'The next waitlisted player has priority. Join the waitlist.');
      }
      signups.push({ role, name: character?.name || ctx.profile.name, user: ctx.profile.id,
        claimId: previous?.role === role ? signupRef(item, previous) : key() });
      item.waitlist = item.waitlist.filter(entry => entry !== waiting);
      if (!previous || previous.role !== role) {
        partyActivity(item, partyPerson(ctx.profile.id, character?.name || ctx.profile.name) +
          (previous ? ' switched from **' + discordText(item.roles[previous.role].name) + '** to **' : ' joined **') +
          discordText(item.roles[role].name) + '**' + (actor.profile.id !== ctx.profile.id ? ' · assigned by ' + actorName : '') + '.');
      }
    } else {
      if (previous) partyActivity(item, partyPerson(previous.user, previous.name) + ' left **' + discordText(item.roles[previous.role].name) + '**' +
        (action === 'remove-signup' ? ' · removed by ' + actorName : '') + '.');
      if (action === 'leave' && waiting) {
        item.waitlist = item.waitlist.filter(entry => entry !== waiting);
        partyActivity(item, actorName + ' left the **' + discordText(item.roles[waiting.role].name) + '** waitlist.');
      }
    }
    item.signups = signups;
    queueGearReminder(item, wasFull);
    item.rosterChanged = true;
    return { updated: item, result: claimed ? 'Slot claimed for ' + item.roles[role].name + '.' : 'Your slot was released.' };
  });
  await settleParty(ctx, id);
  if (discordSignup) return result;
  return findParty(await partiesFor(ctx), id);
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}
async function rawBody(req, limit = 32768) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Problem(415, 'Expected JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new Problem(413, 'Request too large.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function parseBody(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
    return data;
  } catch {
    throw new Problem(400, 'Invalid JSON request.');
  }
}
const body = async req => parseBody(await rawBody(req));

async function interactionSignup(event, id, roleKey) {
  const user = event.member?.user;
  if (!snowflake(user?.id) || user.bot || event.member.pending) throw new Problem(403, 'Join the Discord server first.');
  const prefix = serverId() + ':';
  const profile = { id: user.id, name: event.member.nick || user.global_name || user.username };
  const ctx = { profile, scope: serverId() };
  const [parties, expertise, character, settings, provisioned] = await Promise.all([
    partiesFor(ctx), get(prefix + 'expertise:' + user.id, []), get(prefix + 'character:' + user.id), get(prefix + 'settings'),
    get(expertiseMappingKey(ctx), {})
  ]);
  requireLoginRole(settings, event.member.roles || [], provisioned);
  const availableRoles = await get(prefix + 'expertise-catalog', expertiseRoles);
  Object.assign(ctx, { availableRoles, expertise: expertise.filter(name => availableRoles.includes(name)), character, settings,
    guest: hasGuestRole(settings, event.member.roles, provisioned) });
  const party = findParty(parties, id);
  if (roleKey === 'start') {
    const organizer = await discordCommandContext(event);
    return partyAction(organizer, { id, action: 'start' },
      { roleKey, messageId: event.message.id, channelId: event.channel_id });
  }
  const leaving = roleKey === 'leave';
  const role = leaving ? undefined : party.roles.findIndex(item => hash(item.name).slice(0, 20) === roleKey);
  if (!leaving && role < 0) throw new Problem(409, 'This party button is out of date.');
  if (ctx.guest && party.guildOnly) throw new Problem(403, restrictedPartyMessage(party));
  if (onboardingStep(ctx)) {
    throw new Problem(409, 'Finish setting up your Warband profile at ' + workspaceUrl(id).href + ' before signing up.');
  }
  return partyAction(ctx, { id, action: leaving ? 'leave' : 'join', role },
    { roleKey, messageId: event.message.id, channelId: event.channel_id });
}
const warbandCommand = {
  name: 'warband', type: 1, description: 'Publish an Albion party from a saved Warband template',
  options: [
    { name: 'template', type: 3, description: 'Choose a saved party template', required: true, autocomplete: true, max_length: 80 },
    { name: 'start', type: 3, description: 'MM/DD/YYYY hh:mm AM or PM (UTC+8). Omit for wait-until-full templates.', max_length: 40 },
    { name: 'note', type: 3, description: 'Replace the saved party note', max_length: 420 }
  ]
};
const rosterCommands = [
  { name: 'warband-assign', type: 1, description: 'Assign a registered player to a Warband party role',
    options: [
      { name: 'party', type: 3, description: 'Choose an open party', required: true, autocomplete: true, max_length: 80 },
      { name: 'player', type: 6, description: 'Choose a registered Discord player', required: true },
      { name: 'role', type: 3, description: 'Choose a role in this party', required: true, autocomplete: true, max_length: 80 }
    ] },
  { name: 'warband-remove', type: 1, description: 'Remove a player’s signup from a Warband party',
    options: [
      { name: 'party', type: 3, description: 'Choose an open party', required: true, autocomplete: true, max_length: 80 },
      { name: 'player', type: 6, description: 'Choose the Discord player whose signup to remove', required: true }
    ] }
];
const nextCommandCheck = new Map();
async function syncDiscordCommands() {
  const commandsPath = '/applications/' + client + '/guilds/' + serverId() + '/commands';
  const stateKey = serverId() + ':discord-command-sync:' + client;
  const [templates, previous] = await Promise.all([get(serverId() + ':templates', []), get(stateKey, {})]);
  const publishEnabled = templates.length > 0;
  const desired = hash(JSON.stringify([helpCommand, ...rosterCommands, publishEnabled ? warbandCommand : null]));
  const needsSync = state => Math.max(state.inFlightUntil || 0, state.retryAfter || 0) <= Date.now() &&
    (state.desired !== desired || (state.checkAfter || 0) <= Date.now());
  if (!needsSync(previous)) return;
  const claimed = await db.change(stateKey, {}, null, state => {
    if (!needsSync(state)) return false;
    state.inFlightUntil = Date.now() + 60000;
    return true;
  });
  if (!claimed) return;
  try {
    const installed = await discord(commandsPath, bot);
    const existing = name => installed.find(command => command.name === name && command.type === 1);
    const needsRegistration = previous.desired !== desired;
    if (!existing(helpCommand.name) || needsRegistration) await discord(commandsPath, bot, helpCommand);
    for (const command of rosterCommands) {
      if (!existing(command.name) || needsRegistration) await discord(commandsPath, bot, command);
    }
    if (publishEnabled) {
      if (!existing(warbandCommand.name) || needsRegistration) await discord(commandsPath, bot, warbandCommand);
    } else {
      const command = existing(warbandCommand.name);
      if (snowflake(command?.id)) await discord(commandsPath + '/' + command.id, bot, undefined, 'DELETE');
    }
  } catch (error) {
    console.warn('Warband Discord command sync failed.', { status: error.status, upstreamStatus: error.upstreamStatus });
    await put(stateKey, { retryAfter: Date.now() + Math.max(60000, error.retryAfterMs || 0) });
    return;
  }
  await put(stateKey, { desired, checkAfter: Date.now() + 86400000 });
  console.info('Warband Discord commands synced.', { help: true, warband: publishEnabled });
}
function queueDiscordCommandSync(force = false) {
  if (demo || !interactionKey || (!force && Date.now() < (nextCommandCheck.get(serverId()) || 0))) return;
  nextCommandCheck.set(serverId(), Date.now() + 30000);
  const work = syncDiscordCommands().catch(() => console.warn('Warband Discord command sync could not be saved.'));
  if (onVercel) waitUntil(work);
  else return work;
}
function discordStart(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(typeof value === 'string' ? value.trim() : '');
  if (match) {
    const [, month, day, year, hour, minute, period] = match;
    if (+hour >= 1 && +hour <= 12 && +minute < 60) {
      const localHour = +hour % 12 + (period.toUpperCase() === 'PM' ? 12 : 0);
      const wallTime = new Date(Date.UTC(+year, +month - 1, +day, localHour, +minute));
      if (wallTime.getUTCFullYear() === +year && wallTime.getUTCMonth() === +month - 1 && wallTime.getUTCDate() === +day) {
        return new Date(wallTime.getTime() - 8 * 3600000).toISOString();
      }
    }
  }
  throw new Problem(400, 'Use MM/DD/YYYY hh:mm AM or PM for start. Times are Philippine time (UTC+8).');
}
function discordOrganizer(event) {
  const user = event.member?.user;
  if (!snowflake(user?.id) || user.bot || event.member.pending || !Array.isArray(event.member.roles)) {
    throw new Problem(403, 'Join the Discord server first.');
  }
  return { id: user.id, name: event.member.nick || user.global_name || user.username };
}
async function commandTemplates(event) {
  discordOrganizer(event);
  const [settings, provisioned] = await Promise.all([
    get(serverId() + ':settings'), get(expertiseMappingKey({ scope: serverId() }), {})
  ]);
  const { roles, permissions } = event.member;
  requireLoginRole(settings, roles, provisioned);
  const admin = /^\d{1,32}$/.test(permissions || '') && isAdmin(permissions);
  requireManager({ manager: canOrganize(admin, roles, organizerRoleId(settings, provisioned)) });
  const focused = event.data.options?.find(option => option.name === 'template' && option.focused);
  if (typeof focused?.value !== 'string') return [];
  const search = focused.value.trim().toLowerCase();
  const templates = await get(serverId() + ':templates', []);
  return templates.filter(template => template.title.toLowerCase().includes(search)).slice(0, 25)
    .map(template => ({ name: template.title, value: template.id }));
}
async function discordPlayerContext(profile) {
  const prefix = serverId() + ':';
  const [member, settings, provisioned, character, expertise, availableRoles] = await Promise.all([
    memberFor(profile), get(prefix + 'settings'), get(expertiseMappingKey({ scope: serverId() }), {}),
    get(prefix + 'character:' + profile.id), get(prefix + 'expertise:' + profile.id, []),
    get(prefix + 'expertise-catalog', expertiseRoles)
  ]);
  requireLoginRole(settings, member.roleIds, provisioned);
  const guest = hasGuestRole(settings, member.roleIds, provisioned);
  const ctx = { profile, scope: serverId(), member, settings, character, availableRoles, guest,
    expertise: expertise.filter(role => availableRoles.includes(role)),
    manager: canOrganize(member.admin, member.roleIds, organizerRoleId(settings, provisioned)) };
  return ctx;
}
async function discordCommandContext(event) {
  const ctx = await discordPlayerContext(discordOrganizer(event));
  requireManager(ctx);
  if (onboardingStep(ctx)) throw new Problem(409, 'Finish setting up your Warband profile at ' + base.href + ' before managing parties.');
  return ctx;
}
async function rosterCommandChoices(event) {
  const ctx = await discordCommandContext(event);
  const input = Object.fromEntries(event.data.options?.map(option => [option.name, option.value]) ?? []);
  const focused = event.data.options?.find(option => option.focused);
  if (typeof focused?.value !== 'string') return [];
  const search = focused.value.trim().toLowerCase();
  const parties = (await partiesFor(ctx)).filter(party => !partyClosed(party) && !deletionBusy(party) && canViewParty(ctx, party, ctx.character));
  if (focused.name === 'party') {
    return parties.filter(party => party.title.toLowerCase().includes(search)).slice(0, 25)
      .map(party => ({ name: (party.title + ' · ' + party.zone + ' · ' + party.id.slice(-6)).slice(0, 100), value: party.id }));
  }
  if (focused.name !== 'role' || event.data.name !== 'warband-assign') return [];
  const party = parties.find(party => party.id === input.party);
  if (!party) return [];
  return party.roles.filter(role => role.name.toLowerCase().includes(search)).slice(0, 25).map(role => ({
    name: (role.name + ' · ' + party.signups.filter(entry => party.roles[entry.role]?.name === role.name).length + '/' + role.count).slice(0, 100),
    value: hash(role.name).slice(0, 20)
  }));
}
async function manageRosterFromDiscord(event) {
  const ctx = await discordCommandContext(event);
  await throttle('publish:' + ctx.profile.id, 12);
  const input = Object.fromEntries(event.data.options?.map(option => [option.name, option.value]) ?? []);
  if (typeof input.party !== 'string' || !/^[\w-]{22}$/.test(input.party) || !snowflake(input.player)) {
    throw new Problem(400, 'Choose a party from the suggestions and select a Discord player.');
  }
  const party = findParty(await partiesFor(ctx), input.party);
  if (!canViewParty(ctx, party, ctx.character)) throw new Problem(403, restrictedPartyMessage(party));
  let updated;
  if (event.data.name === 'warband-remove') {
    const signup = party.signups.find(entry => entry.user === input.player);
    if (!signup) throw new Problem(409, 'That player does not have a slot in this party.');
    updated = await partyAction(ctx, { id: party.id, action: 'remove-signup', signupId: signupRef(party, signup) });
    return 'Removed **' + discordText(signup.name) + '** from **' + discordText(updated.title) + '**. The slot is available again.' +
      (updated.announcement === 'failed' ? ' The Discord announcement could not be updated. Open the party in Warband to retry.' : '');
  }
  const role = party.roles.findIndex(role => hash(role.name).slice(0, 20) === input.role);
  if (role < 0) throw new Problem(409, 'Choose a current party role from the suggestions.');
  if (event.data.resolved?.users?.[input.player]?.bot) throw new Problem(400, 'Choose a player account.');
  const player = await discordPlayerContext({ id: input.player, name: 'Selected player' });
  if (!player.character || onboardingStep(player)) throw new Problem(409, 'That player must link their Albion character and save their Warband roles first.');
  updated = await partyAction(player, { id: party.id, action: 'join', role }, undefined, input.role, ctx);
  return 'Assigned **' + discordText(player.character.name) + '** to **' + discordText(updated.roles[role].name) + '** in **' +
    discordText(updated.title) + '**.' +
    (updated.announcement === 'failed' ? ' The Discord announcement could not be updated. Open the party in Warband to retry.' : '');
}
async function publishFromDiscord(event) {
  const ctx = await discordCommandContext(event);
  const { profile } = ctx;
  const prefix = serverId() + ':';
  await throttle('publish:' + profile.id, 12);
  const input = Object.fromEntries(event.data.options?.map(option => [option.name, option.value]) ?? []);
  const selected = field(input.template, 1, 80, 'Template');
  const templates = await get(prefix + 'templates', []);
  const matches = templates.filter(template => template.title.toLowerCase() === selected.toLowerCase());
  const template = templates.find(item => item.id === selected) || (matches.length === 1 ? matches[0] : null);
  if (!template) throw new Problem(404, 'Choose a saved Warband template from the suggestions.');
  const note = field(input.note, 0, 420, 'Party notes');
  const { party } = await publishParty(ctx, { ...template, summary: note || template.summary || '',
    starts: template.waitUntilFull ? null : discordStart(input.start), nonce: event.id });
  const link = workspaceUrl(party.id).href;
  const schedule = party.waitUntilFull ? ' to start when all slots are filled' : ' for <t:' + Math.floor(Date.parse(party.starts) / 1000) + ':F>';
  return 'Published **' + discordText(party.title) + '**' + schedule + '. ' +
    (party.announcement === 'failed' ? 'The Discord announcement failed. Open the party in Warband to retry. ' : '') + link;
}
async function completeDiscordInteraction(event, action, failedMessage) {
  const firstDelivery = await db.change('discord-interaction:' + event.id, {}, Date.now() + 600000, receipt => {
    if (receipt.received) return false;
    receipt.received = true;
    return true;
  });
  if (!firstDelivery) return;
  const content = await action().catch(error => error instanceof Problem ? error.message : failedMessage);
  await discord('/webhooks/' + client + '/' + event.token + '/messages/@original',
    undefined, { content, allowed_mentions: { parse: [] } }, 'PATCH');
}
async function discordInteraction(req, res) {
  if (!interactionKey || demo) throw new Problem(503, 'Discord interactions are unavailable.');
  const stamp = req.headers['x-signature-timestamp'];
  const signature = req.headers['x-signature-ed25519'];
  if (!/^\d{10}$/.test(stamp || '') || Math.abs(Date.now() / 1000 - Number(stamp)) > 300 ||
      !/^[a-f0-9]{128}$/i.test(signature || '')) throw new Problem(401, 'Invalid Discord signature.');
  const raw = await rawBody(req, 262144);
  if (!verify(null, Buffer.concat([Buffer.from(stamp), raw]), interactionKey, Buffer.from(signature, 'hex'))) {
    throw new Problem(401, 'Invalid Discord signature.');
  }
  const event = parseBody(raw);
  if (event.application_id !== client) throw new Problem(401, 'Invalid Discord application.');
  if (event.type === 1) return json(res, { type: 1 });
  if (multiServer) {
    if (!allowedServer(event.guild_id)) throw new Problem(403, 'This server is not enabled for this Warband deployment.');
    return serverContext.run({ guildId: event.guild_id }, () => respondDiscordInteraction(event, res));
  }
  return respondDiscordInteraction(event, res);
}
async function respondDiscordInteraction(event, res) {
  if (event.type === 2 && event.guild_id === serverId() && event.data?.name === helpCommand.name && event.data.type === 1) {
    return json(res, { type: 4, data: helpReply(event, workspaceUrl().href) });
  }
  const isWarband = event.guild_id === serverId() && event.data?.name === warbandCommand.name && event.data.type === 1;
  const isRosterCommand = event.guild_id === serverId() && event.data?.type === 1 && rosterCommands.some(command => command.name === event.data.name);
  if (event.type === 4) {
    const choices = isWarband ? await commandTemplates(event).catch(() => []) :
      isRosterCommand ? await rosterCommandChoices(event).catch(() => []) : [];
    return json(res, { type: 8, data: { choices } });
  }
  const match = /^wb:([\w-]{22}):([a-f0-9]{20}|leave|start)$/.exec(event.data?.custom_id || '');
  const command = event.type === 2 && (isWarband || isRosterCommand);
  const signup = event.type === 3 && event.guild_id === serverId() && match && snowflake(event.message?.id);
  if ((!command && !signup) || !snowflake(event.id) || !/^[\w.-]{1,256}$/.test(event.token || '')) {
    return json(res, { type: 4, data: { content: 'This Warband action is unavailable.', flags: 64 } });
  }
  json(res, { type: 5, data: { flags: 64 } });
  const action = command ? (isRosterCommand ? () => manageRosterFromDiscord(event) : () => publishFromDiscord(event)) :
    () => interactionSignup(event, match[1], match[2]);
  const work = completeDiscordInteraction(event, action, command ? 'The party command could not be completed.' : 'The signup could not be completed.')
    .catch(() => console.error('Discord interaction confirmation failed.'));
  if (onVercel) waitUntil(work);
  else await work;
}
async function oauth(req, res, url) {
  if (demo) throw new Problem(404, 'Discord login is disabled in demo mode.');
  await throttle(url.pathname + ':' + clientAddress(req), 20);
  if (url.pathname === '/auth/discord') {
    const state = key();
    const party = url.searchParams.get('party');
    const selected = url.searchParams.get('server');
    const returnParty = /^[\w-]{22}$/.test(party || '') ? party : '';
    await put('oauth:' + hash(state), multiServer ? { party: returnParty, server: allowedServer(selected) ? selected : '' } : returnParty, Date.now() + 600000);
    res.setHeader('Set-Cookie', cookie(csrf, state, 600));
    const query = new URLSearchParams({ client_id: client, redirect_uri: callback, response_type: 'code', scope: multiServer ? 'identify guilds' : 'identify', state });
    return redirect(res, 'https://discord.com/oauth2/authorize?' + query);
  }
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || state !== readCookie(req, csrf)) return redirect(res, '/?login=cancelled');
  const savedReturn = await db.take('oauth:' + hash(state));
  const party = multiServer ? savedReturn?.party ?? null : savedReturn;
  const selected = multiServer ? savedReturn?.server : '';
  const returnTo = new URLSearchParams(party ? { party } : {});
  if (selected) returnTo.set('server', selected);
  const loginError = reason => {
    returnTo.set('login', reason);
    return redirect(res, '/?' + returnTo);
  };
  if (party === null || !code) return loginError('cancelled');
  let stage = 'token exchange';
  try {
    const exchange = await request('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client, client_secret: secret, grant_type: 'authorization_code', code, redirect_uri: callback })
    }, 'Discord');
    stage = 'user lookup';
    const user = await discord('/users/@me', 'Bearer ' + exchange.access_token);
    if (!snowflake(user.id)) throw new Problem(502, 'Discord returned an unexpected user.');
    const profile = { id: user.id, name: user.global_name || user.username };
    if (multiServer) {
      profile.servers = (await discordGuilds('Bearer ' + exchange.access_token)).map(({ id, name, owner, permissions }) => ({ id, name, owner, permissions }));
      let workspace = selected && profile.servers.some(server => server.id === selected) ? selected : '';
      if (!selected) {
        const connected = (await workspacesFor(profile)).filter(server => server.installed);
        if (connected.length === 1) workspace = connected[0].id;
      }
      if (workspace) {
        await serverContext.run({ guildId: workspace }, async () => {
          const member = await memberFor(profile);
          const [settings, provisioned] = await Promise.all([get(workspace + ':settings'), get(expertiseMappingKey({ scope: workspace }), {})]);
          requireLoginRole(settings, member.roleIds, provisioned);
        });
        profile.workspaceId = workspace;
        returnTo.set('server', workspace);
      }
      await remove(sessionKey(req));
      await session(res, profile, true);
      return redirect(res, returnTo.size ? '/?' + returnTo : '/');
    }
    stage = 'server membership lookup';
    const [member, settings, provisioned] = await Promise.all([
      memberFor(profile), get(serverId() + ':settings'), get(expertiseMappingKey({ scope: serverId() }), {})
    ]);
    requireLoginRole(settings, member.roleIds, provisioned);
    stage = 'session storage';
    await remove(sessionKey(req));
    await session(res, profile, true);
    return redirect(res, party ? '/?party=' + party : '/');
  } catch (error) {
    console.error('Discord sign-in failed', JSON.stringify({
      stage, status: error instanceof Problem ? error.status : 500,
      upstreamStatus: error instanceof Problem ? error.upstreamStatus : undefined
    }));
    return loginError(error instanceof LoginRoleRequired ? 'role' : error.status === 403 ? 'server' : 'failed');
  }
}
const assets = {
  '/albion-online-logo.png': [new URL('./public/albion-online-logo.png', import.meta.url), 'image/png'],
  '/warband-favicon.png': [new URL('./public/warband-favicon.png', import.meta.url), 'image/png'],
  '/warband-logo.png': [new URL('./public/warband-logo.png', import.meta.url), 'image/png'],
  '/warband-banner.webp': [new URL('./public/warband-banner.webp', import.meta.url), 'image/webp'],
  '/dagit-favicon.png': [new URL('./public/dagit-favicon.png', import.meta.url), 'image/png'],
  '/albion-items.json': [new URL('./public/albion-items.json', import.meta.url), 'application/json; charset=utf-8'],
  '/': [new URL('./public/index.html', import.meta.url), 'text/html; charset=utf-8'],
  '/app.js': [new URL('./public/app.js', import.meta.url), 'text/javascript; charset=utf-8'],
  '/style.css': [new URL('./public/style.css', import.meta.url), 'text/css; charset=utf-8'],
  '/stronghold.webp': [new URL('./public/stronghold.webp', import.meta.url), 'image/webp']
};
async function routes(req, res) {
  const url = new URL(req.url, base);
  const path = url.pathname;
  const route = req.method + ' ' + path;
  if (req.method === 'GET' && Object.hasOwn(assets, path)) {
    const [file, mime] = assets[path];
    res.setHeader('Content-Type', mime);
    return res.end(readFileSync(file));
  }
  if (setupRequired) throw new Problem(503, 'Server setup is in progress. Ask your organizer when the board will open.');
  if (route === 'POST /api/discord/interactions') return discordInteraction(req, res);
  if (req.method === 'GET' && ['/auth/discord', '/auth/discord/callback'].includes(path)) {
    await cleanup();
    return oauth(req, res, url);
  }
  if (!path.startsWith('/api/') || !['GET', 'POST'].includes(req.method)) throw new Problem(404, 'Page not found.');
  if (req.method === 'POST' && req.headers.origin !== base.origin) throw new Problem(403, 'This request must come from the party board.');
  if (route === 'POST /api/logout') {
    await remove(sessionKey(req));
    res.setHeader('Set-Cookie', cookie(auth, '', 0));
    return json(res, {});
  }
  await cleanup();
  await throttle('api:' + clientAddress(req), 240);
  if (path === '/api/workspaces') return workspaceRoutes(req, res);
  const ctx = await context(req, res, route === 'GET /api/board').catch(async error => {
    if (error instanceof LoginRoleRequired) {
      await remove(sessionKey(req));
      res.setHeader('Set-Cookie', cookie(auth, '', 0));
      if (route === 'GET /api/board') return { loginError: error.message };
    }
    throw error;
  });
  if (route === 'GET /api/board') {
    if (ctx?.workspaceSelection) return json(res, { signedIn: true, onboarding: 'workspace', multiServer: true,
      workspaces: await workspacesFor(ctx.profile), inviteUrl: discordInviteUrl() });
    if (multiServer && !ctx) return json(res, { demo, signedIn: false, multiServer: true, inviteUrl: discordInviteUrl() });
    await updatePublishedGuide();
    await queueDiscordCommandSync();
    if (!ctx) return json(res, { demo, signedIn: false, multiServer, ...(multiServer ? { inviteUrl: discordInviteUrl() } : {}) });
    if (ctx.loginError) return json(res, { demo, signedIn: false, loginError: ctx.loginError });
    const { settings, profile, character, member, expertise, availableRoles } = ctx;
    const requireMatchingNickname = requiresMatchingNickname(settings);
    const onboarding = onboardingStep(ctx);
    if (onboarding) {
      return json(res, { signedIn: true, onboarding, multiServer, expertise, expertiseRoles: availableRoles,
        guild: settings?.albionGuild?.name, region: settings?.region, requireMatchingNickname,
        guest: ctx.guest,
        guildError: character && onboarding === 'character' && settings?.albionGuild
          ? (ctx.guest ? guestMembershipError(settings.albionGuild) : guildMembershipError(settings.albionGuild)) : '' });
    }
    const parties = await partiesFor(ctx);
    await queuePartyMaintenance(ctx, parties);
    const viewer = await partyViewerCharacter(ctx, parties).catch(() => null);
    const boardSettings = settings && !ctx.manager && !member.admin
      ? { region: settings.region, channel: settings.channel, albionGuild: settings.albionGuild } : settings;
    return json(res, { demo, multiServer, workspaceId: multiServer ? serverId() : undefined, settings: boardSettings, guestsEnabled: Boolean(settings?.guestRoleId), requireMatchingNickname,
      profile: { name: profile.name, avatarUrl: member.avatarUrl ?? null }, character, signedIn: true,
      expertise: ctx.expertise, expertiseRoles: availableRoles,
      mentionRoles: ctx.manager ? mentionChoices(ctx) : [],
      organizerRoleName: organizerRoleName(ctx),
      server: member.server, serverIcon: member.serverIcon ?? null, roles: member.roles, canManage: ctx.manager, canConfigure: member.admin,
      parties: parties.filter(party => canViewParty(ctx, party, viewer)).map(party => visible(party, ctx)) });
  }
  if (!ctx) throw new Problem(401, 'Sign in with Discord first.');
  if (ctx.workspaceSelection) throw new Problem(403, 'Select a Discord server first.');
  const onboarding = onboardingStep(ctx);
  if (route === 'GET /api/party') {
    const id = url.searchParams.get('id');
    if (!/^[\w-]{22}$/.test(id || '')) throw new Problem(404, 'Party not found.');
    const party = findParty(await partiesFor(ctx), id);
    if (ctx.guest && !ctx.manager && party.guildOnly) return json(res, { restricted: restrictedPartyMessage(party) });
    if (onboarding) throw new Problem(403, 'Finish setting up your Warband profile first.');
    const viewer = await partyViewerCharacter(ctx, [party]);
    return json(res, canViewParty(ctx, party, viewer) ? { party: visible(party, ctx) } : { restricted: restrictedPartyMessage(party) });
  }
  if (onboarding && route !== 'POST /api/character' && !(onboarding === 'roles' && route === 'POST /api/expertise')) {
    throw new Problem(403, 'Finish setting up your Warband profile first.');
  }
  if (path === '/api/templates') {
    requireManager(ctx);
    const library = ctx.scope + ':templates';
    if (req.method === 'GET') return json(res, await get(library, []));
    const data = await body(req);
    if (data.action === 'import-preview') {
      const file = data.file;
      if (file?.format !== 'warband-template' || file.version !== 1 || !file.template ||
          typeof file.template !== 'object' || Array.isArray(file.template)) {
        throw new Problem(400, 'Choose a Warband template JSON file (version 1).');
      }
      const input = file.template;
      const details = partyDetails(input);
      if (input.announcementThread !== undefined && typeof input.announcementThread !== 'boolean') {
        throw new Problem(400, 'Choose whether to use Discord threads.');
      }
      if (input.starts != null && (typeof input.starts !== 'string' || !Number.isFinite(Date.parse(input.starts)))) {
        throw new Problem(400, 'Choose a valid template start time.');
      }
      return json(res, { ...details, announcementThread: input.announcementThread === true,
        mentionRoleIds: [], starts: details.waitUntilFull || input.starts == null ? null : new Date(input.starts).toISOString() });
    }
    const templateId = data.id;
    if ((templateId || data.action === 'delete') && (typeof templateId !== 'string' || !/^[\w-]{22}$/.test(templateId))) {
      throw new Problem(400, 'Choose a valid template.');
    }
    if (templateId && data.revision !== null && (typeof data.revision !== 'string' || !/^[\w-]{22}$/.test(data.revision))) {
      throw new Problem(400, 'Reload the template before making changes.');
    }
    if (data.action === 'delete') {
      await db.change(library, [], ctx.profile.expires, templates => {
        const index = templates.findIndex(template => template.id === templateId);
        if (index < 0) return;
        if ((templates[index].revision ?? null) !== data.revision) {
          throw new Problem(409, 'Another organizer changed this template. Review the latest version before deleting it.');
        }
        templates.splice(index, 1);
      });
      await queueDiscordCommandSync(true);
      return json(res, { deleted: true });
    }
    const details = { ...partyDetails(data), ...announcementOptions(data, ctx) };
    if (details.waitUntilFull) details.starts = null;
    else if (data.starts !== undefined) {
      const when = typeof data.starts === 'string' ? Date.parse(data.starts) : NaN;
      if (data.starts !== null && !Number.isFinite(when)) throw new Problem(400, 'Choose a valid template start time.');
      details.starts = data.starts === null ? null : new Date(when).toISOString();
    }
    const template = await db.change(library, [], ctx.profile.expires, templates => {
      if (templateId) {
        const index = templates.findIndex(item => item.id === templateId);
        if (index < 0) throw new Problem(404, 'This template no longer exists.');
        const revision = templates[index].revision ?? null;
        if (revision !== data.revision) {
          throw Object.assign(new Problem(409, 'Another organizer saved changes to this template.'), { templateConflict: { revision } });
        }
        templates[index] = { ...templates[index], ...details, revision: key() };
        return templates[index];
      }
      const existing = templates.find(item => Object.keys(details).every(field =>
        JSON.stringify(field === 'starts' ? item[field] ?? null : field === 'waitUntilFull' ? item[field] ?? false : item[field]) === JSON.stringify(details[field])));
      if (existing) return existing;
      if (templates.length >= 1000) throw new Problem(409, 'The board has reached its template limit.');
      const item = { id: key(), ...details, revision: key() };
      templates.unshift(item);
      return item;
    });
    await queueDiscordCommandSync(true);
    return json(res, template);
  }
  if (route === 'GET /api/options') return json(res, await options(ctx));
  if (route === 'GET /api/roster') return json(res, await (url.searchParams.get('guests') === '1' ?
    guestRosterFor(ctx) : rosterFor(ctx, url.searchParams.get('summary') === '1')));
  if (route === 'GET /api/profile') return json(res, await albionProfile(ctx, url.searchParams));
  if (req.method !== 'POST') throw new Problem(404, 'Page not found.');
  const data = await body(req);
  if (route === 'POST /api/expertise') {
    if (onboarding && data.setup === true) throw new Problem(403, 'Finish setting up your Warband profile first.');
    return json(res, data.setup === true ? await setupExpertiseRoles(ctx, data) : await saveExpertise(ctx, data.roles));
  }
  if (route === 'POST /api/settings') {
    requireManager(ctx, true);
    if (data.action === 'discord-guide') return json(res, await saveDiscordGuide(ctx, data));
    if (data.revision !== (ctx.settings?.revision ?? null)) {
      throw new Problem(409, 'Settings changed. Review the latest values before saving again.');
    }
    if (data.requireMatchingNickname !== undefined && typeof data.requireMatchingNickname !== 'boolean') {
      throw new Problem(400, 'Choose whether to require matching Discord server nicknames.');
    }
    const choices = await options(ctx);
    const role = choices.roles.find(item => item.id === data.roleId);
    const channel = choices.channels.find(item => item.id === data.channelId);
    if (data.roleId && !role) throw new Problem(400, 'Choose an available Discord role.');
    if (!channel) throw new Problem(400, 'Choose a channel where the bot can post.');
    checkRegion(data.region);
    if (typeof data.albionGuildId !== 'string') throw new Problem(400, 'Submit the Albion guild ID field.');
    const id = field(data.albionGuildId, 0, 60, 'Albion guild ID');
    if (id && !(demo && id === demoSettings.albionGuild.id) && !albionId(id)) {
      throw new Problem(400, 'Enter an Albion guild ID from the Killboard.');
    }
    const guild = id ? (demo ? { ...demoSettings.albionGuild, id } : await guildFor(data.region, id)) : null;
    if (guild && !demo) {
      const existing = ctx.settings?.region === data.region && ctx.settings.albionGuild?.id === id
        ? ctx.settings.albionGuild.master : null;
      const name = field(data.guildMaster ?? existing?.name, 0, 30, 'Guild master name');
      if (name && name === existing?.name) guild.master = existing;
      else if (name) {
        const master = await characterFor(data.region, (await findCharacter(data.region, name)).Id);
        if (master.guildId !== id) throw new Problem(400, 'The guild master must belong to the selected Albion guild.');
        guild.master = { id: master.id, name: master.name };
      }
    }
    const expertiseRoleIds = data.expertiseRoleIds === undefined ? ctx.settings?.expertiseRoleIds || {} :
      Object.fromEntries(ctx.availableRoles.map(name => [name, data.expertiseRoleIds?.[name] || '']).filter(([, id]) => id));
    const mappedIds = Object.values(expertiseRoleIds);
    const provisioned = await get(expertiseMappingKey(ctx), {});
    const requireRole = data.requireLoginRole ?? ctx.settings?.requireLoginRole ?? false;
    const loginRoleIds = data.loginRoleIds ?? allowedLoginRoles(ctx.settings);
    const guestRoleId = data.guestRoleId ?? ctx.settings?.guestRoleId ?? '';
    const guestRole = ctx.member.allRoles?.find(item => item.id === guestRoleId);
    const guestPermissions = BigInt(guestRole?.permissions ?? 0);
    if (typeof requireRole !== 'boolean' || !Array.isArray(loginRoleIds) || loginRoleIds.length > 250 ||
        loginRoleIds.some(id => typeof id !== 'string') || new Set(loginRoleIds).size !== loginRoleIds.length ||
        (requireRole && (!loginRoleIds.length || loginRoleIds.some(id => !choices.roles.some(item => item.id === id) || mappedIds.includes(id))))) {
      throw new Problem(400, 'Choose at least one available Discord sign-in role that members cannot assign to themselves in Warband.');
    }
    if (typeof guestRoleId !== 'string' || (guestRoleId && (!guild || guestRoleId === role?.id || mappedIds.includes(guestRoleId) ||
        !choices.roles.some(item => item.id === guestRoleId) || (guestPermissions & (8n | 32n | 268435456n))))) {
      throw new Problem(400, 'Choose a separate Guest role without Administrator, Manage Server, or Manage Roles. Connect an Albion guild first.');
    }
    if (requireRole && guestRoleId && !loginRoleIds.includes(guestRoleId)) {
      throw new Problem(400, 'Select the Guest role in the list of allowed sign-in roles.');
    }
    if (requireRole && !loginRoleIds.some(id => id !== guestRoleId && ctx.member.roleIds.includes(id))) {
      throw new Problem(400, 'Assign yourself at least one of the selected non-guest roles in Discord before enabling this restriction.');
    }
    if (guestRoleId && ctx.member.roleIds.includes(guestRoleId)) {
      throw new Problem(400, 'Remove the Guest role from your Discord account before saving it as the Guest role.');
    }
    if (new Set(mappedIds).size !== mappedIds.length || mappedIds.includes(role?.id) ||
        Object.values(provisioned).includes(role?.id) ||
        (data.expertiseRoleIds !== undefined &&
          mappedIds.some(id => !choices.expertiseRoles.some(choice => choice.id === id)))) {
      throw new Problem(400, 'Map expertise to distinct Discord roles with no server permissions, separate from the organizer role.');
    }
    const settings = { server: ctx.member.server, roleId: role?.id || '', channelId: channel.id, channel: channel.name,
      region: data.region, albionGuild: guild, expertiseRoleIds,
      requireLoginRole: requireRole, loginRoleIds: requireRole ? loginRoleIds : [], loginRoleId: '', guestRoleId, channelType: channel.type,
      requireMatchingNickname: data.requireMatchingNickname ?? requiresMatchingNickname(ctx.settings),
      announcementThread: ctx.settings?.announcementThread === true,
      mentionRoleId: ctx.settings?.mentionRoleId || '', revision: key() };
    await db.change(ctx.scope + ':settings', {}, ctx.profile.expires, current => {
      if ((current.revision ?? null) !== data.revision) {
        throw new Problem(409, 'Settings changed. Review the latest values before saving again.');
      }
      delete current.guildChannelId;
      delete current.guildChannel;
      delete current.guildChannelType;
      Object.assign(current, settings);
    });
    return json(res, {});
  }
  if (route === 'POST /api/character') {
    if (data.unlink === true) {
      await withSyncLock(expertiseMappingKey(ctx) + ':sync', async () => withSyncLock(ctx.expertiseKey + ':sync', async () => {
        await removeDiscordExpertise(ctx);
        await db.removePair(ctx.characterKey, ctx.expertiseKey);
      }));
      return json(res, { synced: true });
    }
    await throttle('character:' + ctx.profile.id, 10);
    const name = field(data.name, 2, 30, 'Character name');
    checkRegion(data.region);
    const guild = ctx.settings?.albionGuild;
    if (!demo && !guild && !ctx.member.admin) throw new Problem(409, 'An organizer needs to configure the Albion guild first.');
    if (!demo && guild && data.region !== ctx.settings.region) throw new Problem(403, 'Link a character in the configured Albion region.');
    const character = demo ? { id: 'demo-' + name.toLowerCase(), name, region: data.region, guild: guild?.name || '', guildId: guild?.id || '' }
      : await characterFor(data.region, (await findCharacter(data.region, name)).Id, { verifyGuild: true });
    if (!demo && guild && ctx.guest === (character.guildId === guild.id)) {
      throw new Problem(403, ctx.guest ? guestMembershipError(guild) : guildMembershipError(guild));
    }
    const sameLink = ctx.character?.id === character.id && ctx.character.region === character.region;
    if (!demo && !sameLink && requiresMatchingNickname(ctx.settings) && !matchesDiscordNickname(ctx.member.nickname, character.name)) {
      throw new Problem(403, 'Your Albion character name must match your Discord server nickname. Register with Albion Assistant first, then enter the same character name.');
    }
    if (ctx.guest) Object.assign(character, { guest: true, avatarUrl: ctx.member.avatarUrl });
    if (!await db.linkCharacter(ctx.characterPrefix, ctx.characterKey, character, ctx.profile.expires)) {
      throw new Problem(409, 'This Albion character is already linked to another Warband account.');
    }
    if (!demo) await saveAffiliation(affiliationKey(ctx.scope, character), {
      checkedAt: Date.now(), character: { id: character.id, name: character.name, guild: character.guild, guildId: character.guildId, region: character.region }
    });
    return json(res, character);
  }
  if (route === 'POST /api/party') {
    requireManager(ctx);
    await throttle('publish:' + ctx.profile.id, 12);
    if (data.action === 'edit') return json(res, visible(await savePartyEdit(ctx, data), ctx));
    const { party, created } = await publishParty(ctx, data);
    return json(res, visible(party, ctx), created ? 201 : 200);
  }
  if (route === 'POST /api/party/action') {
    const party = await partyAction(ctx, data);
    if (party && !canViewParty(ctx, party, ctx.character)) throw new Problem(403, restrictedPartyMessage(party));
    return json(res, party ? visible(party, ctx) : { deleted: true });
  }
  throw new Problem(404, 'Page not found.');
}
export async function handleRequest(req, res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://render.albiononline.com https://cdn.discordapp.com; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    const profile = multiServer && db ? await get(sessionKey(req)) : null;
    await serverContext.run({ guildId: profile?.workspaceId || defaultGuildId }, () => routes(req, res));
  } catch (error) {
    if (!(error instanceof Problem)) console.error(error.name + ' while handling request');
    if (res.headersSent) return res.end();
    json(res, { error: error instanceof Problem ? error.message : 'The party board encountered an error.',
      ...(error.templateConflict ? { templateConflict: error.templateConflict } : {}) }, error instanceof Problem ? error.status : 500);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = http.createServer(handleRequest);
  server.requestTimeout = 20000;
  server.listen(port, process.env.BIND_HOST || (loopback ? '127.0.0.1' : '0.0.0.0'), () => {
    console.log('Albion Party Board available at ' + base.origin + (demo ? ' (demo mode)' : ''));
  });
}
