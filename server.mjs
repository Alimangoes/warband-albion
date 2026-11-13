import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openPostgres, openSQLite } from './storage.mjs';
import { albion, canPost, discord, isAdmin, Problem, regions, request } from './providers.mjs';
import { demoChannels, demoParties, demoRoles, demoRoster, demoSettings } from './demo.mjs';

const port = Number(process.env.PORT || 4317);
const onVercel = process.env.VERCEL === '1';
const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const base = new URL(process.env.APP_URL || (onVercel && vercelDomain ? 'https://' + vercelDomain : 'http://localhost:' + port));
const demo = onVercel ? process.env.DEMO_MODE === 'true' : process.env.DEMO_MODE !== 'false';
const { DISCORD_CLIENT_ID: client, DISCORD_CLIENT_SECRET: secret, DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildId } = process.env;
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
const secure = base.protocol === 'https:';
const snowflake = value => /^\d{17,20}$/.test(value || '');
if ((!secure && !(loopback && base.protocol === 'http:')) || base.href !== base.origin + '/') throw new Error('Set APP_URL to the HTTPS public origin or an HTTP localhost origin.');
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const setupRequired = (!demo && (!snowflake(client) || !snowflake(guildId) || !secret || !token))
  || (onVercel && (!secure || !connectionString));
if (setupRequired && !onVercel) throw new Error('Set the four DISCORD_ values in .env.');
const bot = 'Bot ' + token;
const callback = new URL('/auth/discord/callback', base).href;
const key = () => randomBytes(16).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');

const db = setupRequired ? null : connectionString ? openPostgres(connectionString) : openSQLite();
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

async function memberFor(profile) {
  const [member, guild, roles] = await Promise.all([
    discord('/guilds/' + guildId + '/members/' + profile.id, bot).catch(error => {
      if (error.status === 404) throw new Problem(403, 'Join the configured Discord server to access the board.');
      throw error;
    }),
    discord('/guilds/' + guildId, bot),
    discord('/guilds/' + guildId + '/roles', bot)
  ]);
  const held = roles.filter(role => role.id === guildId || member.roles.includes(role.id));
  if (member.pending) throw new Problem(403, 'Complete Discord membership screening first.');
  const permissions = held.reduce((all, role) => all | BigInt(role.permissions), 0n);
  return { admin: guild.owner_id === profile.id || isAdmin(permissions), roleIds: member.roles,
    roles: held.filter(role => role.id !== guildId).map(role => role.name), server: guild.name, allRoles: roles };
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
  const scope = demo ? profile.id : guildId;
  const member = demo ? { admin: true, roleIds: ['1'], roles: ['Guild Officer'], server: demoSettings.server } : await memberFor(profile);
  const characterKey = scope + ':character:' + profile.id;
  const [settings, character] = await Promise.all([get(scope + ':settings', demo ? demoSettings : null), get(characterKey)]);
  return { profile, scope, member, settings, characterKey, character,
    manager: member.admin || Boolean(settings?.roleId && member.roleIds.includes(settings.roleId)) };
}
function requireManager(ctx, admin = false) {
  if (!(admin ? ctx.member.admin : ctx.manager)) throw new Problem(403, 'Your Discord role cannot perform this action.');
}
async function options(ctx) {
  requireManager(ctx, true);
  if (demo) return { roles: demoRoles, channels: demoChannels };
  const [channels, identity] = await Promise.all([
    discord('/guilds/' + guildId + '/channels', bot), discord('/users/@me', bot)
  ]);
  const botMember = await discord('/guilds/' + guildId + '/members/' + identity.id, bot);
  const roles = ctx.member.allRoles;
  const compact = list => list.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { roles: compact(roles.filter(role => role.id !== guildId && !role.managed)),
    channels: compact(channels.filter(channel => [0, 5].includes(channel.type) && canPost(guildId, roles, botMember, channel))) };
}
function field(value, min, max, label) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (clean.length < min || clean.length > max) throw new Problem(400, label + ' must have ' + min + '–' + max + ' characters.');
  return clean;
}
function checkRegion(region) {
  if (!Object.hasOwn(regions, region)) throw new Problem(400, 'Choose an Albion region.');
}
async function exact(region, name, kind) {
  const result = await albion(region, 'search?q=' + encodeURIComponent(name));
  const list = result[kind === 'guild' ? 'guilds' : 'players'];
  const row = Array.isArray(list) && list.find(item => item.Name?.toLowerCase() === name.toLowerCase());
  if (!row || !/^[\w-]{5,60}$/.test(row.Id)) throw new Problem(404, 'No exact Albion ' + kind + ' found in that region.');
  return row;
}
async function characterFor(region, id) {
  const row = await albion(region, 'players/' + encodeURIComponent(id));
  if (row?.Id !== id || !row.Name) throw new Problem(502, 'Albion returned an unexpected character response.');
  return { id, name: row.Name, guild: row.GuildName || '', guildId: row.GuildId || '', region };
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
function visible(party, ctx) {
  const { nonce, postingAt, channelId, guildId: target, region, hostId, signups, ...fields } = party;
  return { ...fields, signups: signups.map(({ name, role, user }) => ({ name, role, mine: user === ctx.profile.id })) };
}
const types = ['Roads of Avalon', 'PvE', 'PvP', 'Gathering', 'Faction Warfare', 'Other'];
function partyData(data, ctx) {
  const settings = ctx.settings;
  if (!settings) throw new Problem(409, 'Save a Discord channel in Settings first.');
  const title = field(data.title, 2, 80, 'Party name');
  const zone = field(data.zone, 1, 80, 'Meeting location');
  const summary = field(data.summary, 0, 420, 'Party notes');
  if (!types.includes(data.type)) throw new Problem(400, 'Choose an activity.');
  const when = typeof data.starts === 'string' ? Date.parse(data.starts) : NaN;
  if (!Number.isFinite(when) || when <= Date.now() || when > Date.now() + 366 * 86400000) throw new Problem(400, 'Choose a future time within the next year.');
  if (!Array.isArray(data.roles) || !data.roles.length || data.roles.length > 20) throw new Problem(400, 'Add between 1 and 20 roles.');
  const roles = data.roles.map(role => {
    const name = field(role?.name, 1, 36, 'Role name');
    if (!Number.isInteger(role.count) || role.count < 1 || role.count > 20) throw new Problem(400, 'Each role needs 1 to 20 slots.');
    return { name, count: role.count };
  });
  if (new Set(roles.map(role => role.name.toLowerCase())).size !== roles.length) throw new Problem(400, 'Give each role a different name.');
  if (roles.reduce((sum, role) => sum + role.count, 0) > 20) throw new Problem(400, 'A party can have up to 20 slots.');
  if (data.guildOnly === true && !settings.albionGuild) throw new Problem(400, 'Set an Albion guild in Settings first.');
  if (typeof data.nonce !== 'string' || !/^[\w-]{12,24}$/.test(data.nonce)) throw new Problem(400, 'Invalid party submission.');
  return { id: key(), nonce: data.nonce, title, zone, summary, type: data.type, starts: new Date(when).toISOString(), roles,
    signups: [], host: ctx.character?.name || ctx.profile.name, hostId: ctx.profile.id, channel: settings.channel,
    channelId: settings.channelId, guildOnly: data.guildOnly === true, guildId: settings.albionGuild?.id,
    guild: settings.albionGuild?.name, region: settings.region, announcement: demo ? 'demo' : 'pending' };
}

const discordText = text => text.replace(/[\\*_~|>\[\]<>`]/g, '\\$&').replace(/@/g, '@\u200b').replace(/[\r\n]/g, ' ');
async function announce(ctx, id) {
  const party = await editParties(ctx, parties => {
    const item = findParty(parties, id);
    if (item.cancelled || Date.parse(item.starts) <= Date.now()) throw new Problem(409, 'This party has closed.');
    if (item.announcement === 'sent' || Date.now() - (item.postingAt || 0) < 15000) return null;
    Object.assign(item, { announcement: 'pending', postingAt: Date.now(), deliveryError: null });
    return item;
  });
  if (!party) return;
  let result;
  try {
    const stamp = Math.floor(Date.parse(party.starts) / 1000);
    const roles = party.roles.map(role => discordText(role.name) + ' ×' + role.count).join(' · ');
    const link = new URL('/?party=' + id, base).href;
    const message = await discord('/channels/' + party.channelId + '/messages', bot, {
      content: '**' + discordText(party.title) + '**\n' + party.type + ' · ' + discordText(party.zone) +
        '\n<t:' + stamp + ':F> (<t:' + stamp + ':R>)\n' + roles +
        (party.guildOnly ? '\nGuild only · ' + discordText(party.guild) : '') + '\n' + link,
      allowed_mentions: { parse: [] }, flags: 4, nonce: id, enforce_nonce: true
    });
    result = { announcement: 'sent', messageUrl: 'https://discord.com/channels/' + guildId + '/' + party.channelId + '/' + message.id };
  } catch (error) {
    result = { announcement: 'failed', deliveryError: error instanceof Problem ? error.message : 'Discord delivery could not be confirmed.' };
  }
  await editParties(ctx, parties => Object.assign(findParty(parties, id), result, { postingAt: null }));
}
async function partyAction(ctx, { id, action, role }) {
  if (!['join', 'leave', 'cancel', 'retry'].includes(action)) throw new Problem(400, 'Choose a party action.');
  if (['cancel', 'retry'].includes(action)) requireManager(ctx);
  if (action === 'retry') {
    await throttle('publish:' + ctx.profile.id, 12);
    if (!demo) await announce(ctx, id);
    return findParty(await partiesFor(ctx), id);
  }
  const current = findParty(await partiesFor(ctx), id);
  let character = ctx.character;
  if (action === 'join' && current.guildOnly) {
    if (character?.region !== current.region) throw new Problem(403, 'Link a character in the party’s Albion region first.');
    if (!demo) character = await characterFor(character.region, character.id);
    if (character.guildId !== current.guildId) throw new Problem(403, 'This party is reserved for ' + current.guild + '.');
  }
  return editParties(ctx, parties => {
    const item = findParty(parties, id);
    if (action === 'cancel') {
      if (Date.now() - (item.postingAt || 0) < 15000) throw new Problem(409, 'The announcement is posting. Try again shortly.');
      item.cancelled = true;
      return item;
    }
    if (item.cancelled || Date.parse(item.starts) <= Date.now()) throw new Problem(409, 'Signups are closed for this party.');
    const signups = item.signups.filter(entry => entry.user !== ctx.profile.id);
    if (action === 'join') {
      if (!Number.isInteger(role) || !item.roles[role]) throw new Problem(400, 'Choose a party role.');
      if (signups.filter(entry => entry.role === role).length >= item.roles[role].count) throw new Problem(409, 'That role is full.');
      signups.push({ role, name: character?.name || ctx.profile.name, user: ctx.profile.id });
    }
    item.signups = signups;
    return item;
  });
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Problem(415, 'Expected JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16384) {
      req.resume();
      throw new Problem(413, 'Request too large.');
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
    return data;
  } catch {
    throw new Problem(400, 'Invalid JSON request.');
  }
}
async function oauth(req, res, url) {
  if (demo) throw new Problem(404, 'Discord login is disabled in demo mode.');
  await throttle(url.pathname + ':' + clientAddress(req), 20);
  if (url.pathname === '/auth/discord') {
    const state = key();
    const party = url.searchParams.get('party');
    await put('oauth:' + hash(state), /^[\w-]{22}$/.test(party || '') ? party : '', Date.now() + 600000);
    res.setHeader('Set-Cookie', cookie(csrf, state, 600));
    const query = new URLSearchParams({ client_id: client, redirect_uri: callback, response_type: 'code', scope: 'identify', state });
    return redirect(res, 'https://discord.com/oauth2/authorize?' + query);
  }
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || state !== readCookie(req, csrf)) return redirect(res, '/?login=cancelled');
  const party = await db.take('oauth:' + hash(state));
  if (party === null || !code) return redirect(res, '/?login=cancelled');
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
    stage = 'server membership lookup';
    await memberFor(profile);
    stage = 'session storage';
    await remove(sessionKey(req));
    await session(res, profile, true);
    return redirect(res, party ? '/?party=' + party : '/');
  } catch (error) {
    console.error('Discord sign-in failed', JSON.stringify({
      stage, status: error instanceof Problem ? error.status : 500,
      upstreamStatus: error instanceof Problem ? error.upstreamStatus : undefined
    }));
    return redirect(res, '/?login=' + (error.status === 403 ? 'server' : 'failed'));
  }
}
const assets = {
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
  const ctx = await context(req, res, route === 'GET /api/board');
  if (route === 'GET /api/board') {
    if (!ctx) return json(res, { demo, signedIn: false });
    const { settings, profile, character, member } = ctx;
    return json(res, { demo, settings, profile: { name: profile.name }, character, signedIn: true,
      server: member.server, roles: member.roles, canManage: ctx.manager, canConfigure: member.admin,
      parties: (await partiesFor(ctx)).map(party => visible(party, ctx)) });
  }
  if (!ctx) throw new Problem(401, 'Sign in with Discord first.');
  if (route === 'GET /api/options') return json(res, await options(ctx));
  if (route === 'GET /api/roster') {
    const { albionGuild: guild, region } = ctx.settings || {};
    if (!guild) return json(res, { guild: null, members: [] });
    const roster = demo ? demoRoster.map(Name => ({ Name })) : await albion(region, 'guilds/' + guild.id + '/members');
    if (!Array.isArray(roster)) throw new Problem(502, 'Albion returned an unexpected roster.');
    return json(res, { guild: guild.name, members: roster.map(row => row.Name).filter(name => typeof name === 'string').sort() });
  }
  if (req.method !== 'POST') throw new Problem(404, 'Page not found.');
  const data = await body(req);
  if (route === 'POST /api/settings') {
    requireManager(ctx, true);
    const choices = await options(ctx);
    const role = choices.roles.find(item => item.id === data.roleId);
    const channel = choices.channels.find(item => item.id === data.channelId);
    if (data.roleId && !role) throw new Problem(400, 'Choose an available Discord role.');
    if (!channel) throw new Problem(400, 'Choose a channel where the bot can post.');
    checkRegion(data.region);
    const name = field(data.guild, 0, 60, 'Guild name');
    const guild = name ? (demo ? { Id: 'demo', Name: name } : await exact(data.region, name, 'guild')) : null;
    await put(ctx.scope + ':settings', { server: ctx.member.server, roleId: role?.id || '', channelId: channel.id, channel: channel.name,
      region: data.region, albionGuild: guild ? { id: guild.Id, name: guild.Name } : null }, ctx.profile.expires);
    return json(res, {});
  }
  if (route === 'POST /api/character') {
    if (data.unlink === true) {
      await remove(ctx.characterKey);
      return json(res, {});
    }
    await throttle('character:' + ctx.profile.id, 10);
    const name = field(data.name, 2, 30, 'Character name');
    checkRegion(data.region);
    const guild = ctx.settings?.albionGuild;
    const character = demo ? { id: 'demo-' + name, name, region: data.region, guild: guild?.name || '', guildId: guild?.id || '' }
      : await characterFor(data.region, (await exact(data.region, name, 'character')).Id);
    await put(ctx.characterKey, character, ctx.profile.expires);
    return json(res, character);
  }
  if (route === 'POST /api/party') {
    requireManager(ctx);
    await throttle('publish:' + ctx.profile.id, 12);
    const draft = partyData(data, ctx);
    const saved = await editParties(ctx, parties => {
      const duplicate = parties.find(party => party.hostId === draft.hostId && party.nonce === draft.nonce);
      if (duplicate) return duplicate;
      if (parties.length >= 1000) throw new Problem(409, 'The board has reached its party limit.');
      parties.unshift(draft);
      return draft;
    });
    if (!demo && saved.id === draft.id) await announce(ctx, saved.id);
    return json(res, visible(findParty(await partiesFor(ctx), saved.id), ctx), saved.id === draft.id ? 201 : 200);
  }
  if (route === 'POST /api/party/action') return json(res, visible(await partyAction(ctx, data), ctx));
  throw new Problem(404, 'Page not found.');
}
export async function handleRequest(req, res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    await routes(req, res);
  } catch (error) {
    if (!(error instanceof Problem)) console.error(error.name + ' while handling request');
    if (res.headersSent) return res.end();
    json(res, { error: error instanceof Problem ? error.message : 'The party board encountered an error.' }, error instanceof Problem ? error.status : 500);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = http.createServer(handleRequest);
  server.requestTimeout = 20000;
  server.listen(port, process.env.BIND_HOST || (loopback ? '127.0.0.1' : '0.0.0.0'), () => {
    console.log('Albion Party Board available at ' + base.origin + (demo ? ' (demo mode)' : ''));
  });
}
