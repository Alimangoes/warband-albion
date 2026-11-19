import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'http://127.0.0.1:4389', client = '100000000000000001';
const digits = String(Date.now());
const guild = '1234567' + digits;
const [admin, guest, guest2, member, denied, pending, syncer, botId] =
  Array.from({length:8}, (_,i) => String(100000000000000010n + BigInt(i)));
const [memberRole, guestRole, organizerRole, playRole] = ['100000000000000023','100000000000000024','100000000000000025','100000000000000026'];
const [channel, privateChannel] = ['100000000000000031','100000000000000032'];
const [openId, privateId] = ['public_party_123456789','secret_party_123456789'];
const [guildKey, guestGuild] = ['DAGIT_VALID_ID','GUEST_VALID_ID'];
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
Object.assign(process.env, { APP_URL: origin, DEMO_MODE: 'false', VERCEL: '', DISCORD_CLIENT_ID: client, DISCORD_GUILD_ID: guild,
  DISCORD_CLIENT_SECRET: 'local-fixture', DISCORD_BOT_TOKEN: 'local-fixture',
  DISCORD_PUBLIC_KEY: publicKey.export({ type:'spki', format:'der' }).subarray(-32).toString('hex') });
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const { handleRequest } = await import(pathToFileURL(resolve('server.mjs')));
const { openSQLite } = await import(pathToFileURL(resolve('storage.mjs')));
const db = openSQLite();
const prefix = guild + ':';
const hash = value => createHash('sha256').update(value).digest('hex');
const accounts = new Map([
  [admin, { name:'GuildAdmin', roles:[memberRole] }],
  [member, { name:'DAGITMember', roles:[memberRole] }],
  [guest, { name:'FriendlyGuest', roles:[guestRole] }],
  [guest2, { name:'SecondGuest', roles:[guestRole,memberRole] }],
  [denied, { name:'NoAccess', roles:[playRole] }],
  [pending, { name:'PendingAccount', roles:[guestRole], pending:true }],
  [syncer, { name:'ComingGuest', roles:[guestRole] }],
  [botId, { name:'Warband', roles:[] }],
]);
const chars = [
  { Id:'player-admin', Name:'GuildAdmin', GuildName:'DAGIT', GuildId:guildKey },
  { Id:'player-member', Name:'DAGITMember', GuildName:'DAGIT', GuildId:guildKey },
  { Id:'player-target', Name:'UnlinkedDAGIT', GuildName:'DAGIT', GuildId:guildKey },
  { Id:'player-guest', Name:'FriendlyGuest', GuildName:'Guest Guild', GuildId:guestGuild },
  { Id:'player-guest2', Name:'SecondGuest', GuildName:'Unseen Guild', GuildId:'UNSEEN_ID' },
  { Id:'player-syncer', Name:'ComingGuest', GuildName:'Guest Guild', GuildId:guestGuild },
  { Id:'player-other', Name:'NotRegistered', GuildName:'Another Guild', GuildId:'OTHER_ID' },
];
const roles = [{ id:guild, name:'@everyone', permissions:'3072', position:0 }, ...[
  [memberRole,'Members'],[guestRole,'Guest'],[organizerRole,'Council'],[playRole,'tank']
].map(([id,name],position)=>({ id,name,permissions:'0',position:position+1 }))];
const channels = [{ id:channel,name:'shared-parties',type:0,permission_overwrites:[] },
  { id:privateChannel,name:'private-dagit',type:0,permission_overwrites:[] }];
const messages = new Map();
const thread = '100000000000000090';
const replies = new Map(); const announcements = new Map();
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.origin === origin) return nativeFetch(input, options);
  const path = url.pathname;
  const json = (body, status=200) => new Response(JSON.stringify(body), { status });
  if (url.hostname === 'discord.com') {
    if (path === '/api/oauth2/token') return json({ access_token:options.body.get('code') });
    if (path === '/api/v10/users/@me') {
      const bearer = options.headers.Authorization === 'Bot local-fixture' ? botId : options.headers.Authorization.split(' ')[1];
      return json({ id:bearer, username:accounts.get(bearer)?.name });
    }
    if (path === '/api/v10/guilds/' + guild) return json({ name:'DAGIT', owner_id:admin });
    if (path.endsWith('/roles')) return json(roles);
    if (path.endsWith('/channels')) return json(channels);
    const account = path.match(/\/members\/(\d+)$/)?.[1];
    if (account) {
      const fields = accounts.get(account);
      return fields ? json({ user:{id:account, username:fields.name, discriminator:'0'}, nick:'[tag] ' + fields.name,
        roles:fields.roles, pending:fields.pending }) : json({},404);
    }
    if (path.includes('/commands')) return json(options.method === 'GET' ? [] : {});
    if (path.includes('/messages/@original')) {
      replies.set(path.split('/')[5], JSON.parse(options.body).content);
      return json({});
    }
    if (path.endsWith('/threads')) return json({id:thread});
    const destination = path.match(/\/channels\/(\d+)\/messages(?:\/(\d+))?$/);
    if (destination) {
      const messageId = destination[2] || String(100000000000000050n + BigInt(messages.size));
      messages.set(messageId, destination[1]); if (options.body) announcements.set(messageId, JSON.parse(options.body));
      return json({ id:messageId });
    }
  }
  if (url.hostname.endsWith('albiononline.com')) {
    if (path.endsWith('/search')) return json({ players:chars.filter(char=>char.Name.toLowerCase() === url.searchParams.get('q').toLowerCase()) });
    if (path.endsWith('/guilds/' + guildKey)) return json({ Id:guildKey, Name:'DAGIT' });
    if (path.endsWith('/guilds/' + guildKey + '/members')) return json(chars.filter(char=>char.GuildId===guildKey));
    if (/(kills|deaths)$/.test(path)) return json([]);
    const found = chars.find(char=>path.endsWith('/players/' + char.Id));
    if (found) return json(found);
  }
  return json({message:'Mock route missing ' + path}, 404);
};
const stored = char => ({ id:char.Id,name:char.Name,guild:char.GuildName,guildId:char.GuildId,region:'asia' });
db.put(prefix + 'settings', { roleId:organizerRole, channelId:channel,channel:'shared-parties',channelType:0, region:'asia',
  albionGuild:{id:guildKey,name:'DAGIT'}, requireLoginRole:true, loginRoleId:memberRole, requireMatchingNickname:true });
for (const [discordId,char] of [[admin,chars[0]],[member,chars[1]]]) {
  db.put(prefix + 'character:' + discordId, stored(char));
  db.put(prefix + 'expertise:' + discordId, ['tank']);
}
db.put(prefix + 'expertise-discord-roles', { tank:playRole });
const { default: vercelHandler } = await import(pathToFileURL(resolve('api/warband.mjs')));
const server = http.createServer(vercelHandler);
await new Promise(resolve => server.listen(4389,'127.0.0.1',resolve));
const request = (path, cookie, data) => nativeFetch(origin + path, {
  headers: { ...(cookie ? { cookie } : {}), ...(data ? { origin, 'content-type':'application/json' } : {}) },
  ...(data ? { method:'POST', body:JSON.stringify(data) } : {}), redirect:'manual'
});
async function login(who, party) {
  const initial = await request('/auth/discord' + (party ? '?party=' + party : ''));
  const state = new URL(initial.headers.get('location')).searchParams.get('state');
  return request('/auth/discord/callback?state=' + state + '&code=' + who, initial.headers.getSetCookie()[0].split(';')[0]);
}
const cookie = result => result.headers.getSetCookie().find(header=>header.startsWith('albion_session=')).split(';')[0];
const api = (what, auth, data) => request('/api/' + what, auth, data);
async function ok(response) {
  const json = await response.json();
  assert.ok(response.ok, JSON.stringify(json));
  return json;
}
const adminCookie = cookie(await login(admin));
const memberCookie = cookie(await login(member));
const details = { title:'Roster ping fixture',type:'PvE',zone:'Thetford',roles:[{name:'Tank',count:2}],
  waitUntilFull:true, announcementThread:true, nonce:randomBytes(10).toString('hex') };
const party = await ok(await api('party',adminCookie,details));
const action = async (auth, name, role) => api('party/action',auth,{ id:party.id,action:name,role });
assert.equal(party.canPingRoster,false);
assert.equal((await action(adminCookie,'ping')).status,409);
const first = await ok(await action(adminCookie,'join',0));
assert.equal(first.canPingRoster,true);
assert.equal((await action(memberCookie,'ping')).status,403);
const pings = () => [...announcements.entries()].filter(([,data]) => data.allowed_mentions?.users.length > 0);
assert.equal(pings().length,0);
await ok(await action(adminCookie,'ping'));
assert.equal(pings().length,1);
assert.match(pings()[0][1].content, /Party check-in/);
assert.deepEqual(pings()[0][1].allowed_mentions, {parse:[],users:[admin]});
assert.equal((await action(adminCookie,'ping')).status,429);

const event = { id:String(650000000000000000n + BigInt(Date.now())),token:'ping-signed-fixture',application_id:client,type:3,
  guild_id:guild, channel_id:thread, member:{user:{id:member,username:'DAGITMember'},roles:[memberRole]},
  message:{id:party.messageUrl.split('/').at(-1)}, data:{custom_id:'wb:' + party.id + ':' + hash('Tank').slice(0,20)} };
const payload = JSON.stringify(event), stamp = String(Math.floor(Date.now()/1000));
const signature = sign(null,Buffer.from(stamp+payload),privateKey).toString('hex');
const response = await nativeFetch(origin+'/api/discord/interactions',{method:'POST',headers:{
  'content-type':'application/json','x-signature-timestamp':stamp,'x-signature-ed25519':signature},body:payload});
assert.equal((await ok(response)).type,5);
for(let i=0;i<30 && !replies.has(event.token);i++) await pause(30);
assert.match(replies.get(event.token), /Slot claimed/);
assert.equal(pings().length,2);
const [message, reminder] = pings()[1];
assert.equal(messages.get(message),thread);
assert.match(reminder.content, /Party full[!].*Gear up/);
assert.deepEqual(reminder.allowed_mentions, {parse:[],users:[admin,member]});
assert.equal(reminder.enforce_nonce,true);
assert.ok(reminder.nonce.length <= 25);
await ok(await action(memberCookie,'leave'));
await ok(await action(memberCookie,'join',0));
assert.equal(pings().length,2);

const webParty = await ok(await api('party',adminCookie,{...details,roles:[{name:'Tank',count:1}],nonce:randomBytes(10).toString('hex')}));
await ok(await api('party/action',memberCookie,{id:webParty.id,action:'join',role:0}));
assert.equal(pings().length,3);
assert.deepEqual(pings()[2][1].allowed_mentions.users,[member]);
const channelParty = await ok(await api('party',adminCookie,{...details,announcementThread:false,
  roles:[{name:'Tank',count:1}],nonce:randomBytes(10).toString('hex')}));
const outsideThread = await ok(await api('party/action',memberCookie,{id:channelParty.id,action:'join',role:0}));
assert.equal(outsideThread.canPingRoster,false);
assert.equal(pings().length,3);
console.log('Manual organizer ping, per-party throttling, signed Discord and web claims, once-only gear reminder, and thread-only routing verified.');
db.put(prefix + 'settings', { ...db.get(prefix + 'settings'), loginRoleIds:[memberRole,guestRole], guestRoleId:guestRole });
db.put(prefix + 'character:' + guest, { ...stored(chars[3]), guest:true });
db.put(prefix + 'expertise:' + guest, ['tank']);
const guestCookie = cookie(await login(guest));
const removalParty = await ok(await api('party',adminCookie,{...details,nonce:randomBytes(10).toString('hex')}));
const removalAction = (auth, action, fields = {}) =>
  api('party/action',auth,{id:removalParty.id,action,...fields});
await ok(await removalAction(memberCookie,'join',{role:0}));
const guestView = await ok(await removalAction(guestCookie,'join',{role:0}));
assert.ok(guestView.signups.every(entry => !Object.hasOwn(entry,'signupId') && !Object.hasOwn(entry,'user')));
const savedParties = db.get(prefix + 'parties');
delete savedParties.find(p => p.id === removalParty.id).signups[0].claimId;
db.put(prefix + 'parties',savedParties);
const adminView = await ok(await api('party?id=' + removalParty.id,adminCookie));
const [memberClaim,guestClaim] = adminView.party.signups;
assert.ok(memberClaim.signupId && guestClaim.signupId && memberClaim.signupId !== member);
assert.equal((await removalAction(memberCookie,'remove-signup',{signupId:guestClaim.signupId})).status,403);
assert.equal((await removalAction(guestCookie,'remove-signup',{signupId:memberClaim.signupId})).status,403);
assert.equal((await removalAction(adminCookie,'remove-signup',{signupId:guest})).status,400);
const left = await ok(await removalAction(adminCookie,'remove-signup',{signupId:guestClaim.signupId}));
assert.deepEqual(left.signups.map(entry => entry.name),[memberClaim.name]);
const announcement = () => announcements.get(removalParty.messageUrl.split('/').at(-1)).embeds[0].description;
assert.doesNotMatch(announcement(),new RegExp(guest));
assert.match(announcement(),new RegExp(member));
await ok(await removalAction(guestCookie,'join',{role:0}));
assert.equal((await removalAction(adminCookie,'remove-signup',{signupId:guestClaim.signupId})).status,409);
const removedMember = await ok(await removalAction(adminCookie,'remove-signup',{signupId:memberClaim.signupId}));
assert.deepEqual(removedMember.signups.map(entry => entry.name),[guestClaim.name]);
assert.doesNotMatch(announcement(),new RegExp(member));
assert.match(announcement(),new RegExp(guest));
const finished = await ok(await removalAction(adminCookie,'finish'));
assert.equal((await removalAction(adminCookie,'remove-signup',{signupId:finished.signups[0].signupId})).status,409);
console.log('Organizer-only member and guest removal, legacy claims, safe reclaims, closed-party handling and Discord edits verified.');
const toggled = await ok(await api('party',adminCookie,{...details,
  roles:[{name:'Tank',count:1},{name:'Healer',count:1}],nonce:randomBytes(10).toString('hex')}));
const buttonPartyMessage = toggled.messageUrl.split('/').at(-1);
let clickCount = 0;
async function dispatchPartyButton(who, selection, overrides = {}) {
  const number = ++clickCount;
  const token = 'toggle-fixture-' + number;
  const event = {id:String(660000000000000000n + BigInt(Date.now()) * 100n + BigInt(number)),
    token, application_id:client,type:3, guild_id:guild, channel_id:thread,
    member:{user:{id:who,username:accounts.get(who).name},roles:accounts.get(who).roles},
    message:{id:buttonPartyMessage},
    data:{custom_id:'wb:' + toggled.id + ':' + (selection === 'leave' ? selection : hash(selection).slice(0,20))},
    ...overrides};
  const payload = JSON.stringify(event), stamp = String(Math.floor(Date.now()/1000));
  const signature = sign(null,Buffer.from(stamp+payload),privateKey).toString('hex');
  const response = await nativeFetch(origin+'/api/discord/interactions',{method:'POST',headers:{
    'content-type':'application/json','x-signature-timestamp':stamp,'x-signature-ed25519':signature},body:payload});
  assert.equal((await ok(response)).type,5);
  for(let i=0;i<30 && !replies.has(token);i++) await pause(30);
  return replies.get(token);
}
const toggledRoster = async () => (await ok(await api('party?id=' + toggled.id,adminCookie))).party.signups;
const components = id => announcements.get(id).components;
assert.equal(components(buttonPartyMessage)[0].components.at(-1).label,'Leave party');
assert.match(await dispatchPartyButton(member,'Tank'),/claimed for Tank/);
assert.match(await dispatchPartyButton(member,'Tank'),/slot was released/);
assert.equal((await toggledRoster()).length,0);
assert.match(await dispatchPartyButton(member,'leave'),/do not have a slot/);
assert.match(await dispatchPartyButton(member,'Tank'),/claimed for Tank/);
assert.match(await dispatchPartyButton(guest,'Healer'),/claimed for Healer/);
assert.match(await dispatchPartyButton(member,'Healer'),/role is full/);
assert.deepEqual((await toggledRoster()).map(entry => entry.role),[0,1]);
assert.match(await dispatchPartyButton(guest,'leave',{channel_id:channel}),/out of date/);
assert.match(await dispatchPartyButton(guest,'leave',{message:{id:'100000000000000099'}}),/out of date/);
assert.match(await dispatchPartyButton(guest,'leave'),/slot was released/);
assert.match(await dispatchPartyButton(member,'Healer'),/claimed for Healer/);
assert.deepEqual((await toggledRoster()).map(entry => entry.role),[1]);
await ok(await api('party/action',memberCookie,{id:toggled.id,action:'join',role:1,discordMessageId:buttonPartyMessage}));
assert.equal((await toggledRoster()).length,1);
await ok(await api('party/action',adminCookie,{id:toggled.id,action:'finish'}));
assert.ok(components(buttonPartyMessage).flatMap(row => row.components).every(control => control.disabled));
const fullButtonParty = await ok(await api('party',adminCookie,{...details,
  roles:Array.from({length:20},(_,i)=>({name:'Role ' + i,count:1})),nonce:randomBytes(10).toString('hex')}));
assert.deepEqual(components(fullButtonParty.messageUrl.split('/').at(-1)).map(row => row.components.length),[5,5,5,5,1]);
console.log('Discord tap to claim and release, explicit Leave, switching, full roles, stale messages, closed signups and 20-role layout verified.');
await new Promise(resolve => server.close(resolve));

