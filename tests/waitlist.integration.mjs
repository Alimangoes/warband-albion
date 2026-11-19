import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'http://127.0.0.1:4393', client = '100000000000000001';
const digits = String(Date.now());
const testNamespace = 'test-waitlist-' + digits;
const guild = '1234567' + digits;
const [admin, guest, guest2, member, denied, pending, syncer, botId] =
  Array.from({length:8}, (_,i) => String(100000000000000010n + BigInt(i)));
const [memberRole, guestRole, organizerRole, playRole] = ['100000000000000023','100000000000000024','100000000000000025','100000000000000026'];
const [channel, privateChannel] = ['100000000000000031','100000000000000032'];
const [openId, privateId] = ['public_party_123456789','secret_party_123456789'];
const [guildKey, guestGuild] = ['DAGIT_VALID_ID','GUEST_VALID_ID'];
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
Object.assign(process.env, { APP_URL: origin, DEMO_MODE: 'false', VERCEL: '', DISCORD_CLIENT_ID: client, DISCORD_GUILD_ID: guild,
  MULTI_SERVER_MODE:'false', DATA_NAMESPACE:testNamespace,
  DISCORD_CLIENT_SECRET: 'local-fixture', DISCORD_BOT_TOKEN: 'local-fixture',
  DISCORD_PUBLIC_KEY: publicKey.export({ type:'spki', format:'der' }).subarray(-32).toString('hex') });
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const { handleRequest } = await import(pathToFileURL(resolve('server.mjs')));
const { openSQLite, namespaceStore } = await import(pathToFileURL(resolve('storage.mjs')));
const rawDb = openSQLite();
const db = namespaceStore(rawDb, testNamespace);
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
await new Promise(resolve => server.listen(4393,'127.0.0.1',resolve));
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
db.put(prefix+'settings',{...db.get(prefix+'settings'),loginRoleIds:[memberRole,guestRole],guestRoleId:guestRole});
for (const [who,char] of [[guest,chars[3]],[guest2,chars[4]]]) {
  db.put(prefix+'character:'+who,{...stored(char),guest:true});
  db.put(prefix+'expertise:'+who,['tank']);
}
const guestCookie = cookie(await login(guest)), guest2Cookie = cookie(await login(guest2));
const details = {title:'Lifecycle fixture',type:'PvE',zone:'Thetford',waitUntilFull:true,announcementThread:true,
  roles:[{name:'Tank',count:1},{name:'Healer',count:1}],nonce:randomBytes(10).toString('hex')};
const party = await ok(await api('party',adminCookie,details));
const savedParties=db.get(prefix+'parties');
delete savedParties.find(x=>x.id===party.id).announcementVersion;
db.put(prefix+'parties',savedParties);
await ok(await api('board',adminCookie));
assert.equal(db.get(prefix+'parties').find(x=>x.id===party.id).announcementVersion,2);
const act = (auth,action,extra={},id=party.id)=>api('party/action',auth,{id,action,...extra});
const read = async (id=party.id)=>(await ok(await api('party?id='+id,adminCookie))).party;
let eventIndex=0;
async function click(who,roleKey,id=party.id,sourceParty=party) {
  const token='lifecycle-'+(++eventIndex);
  const evt={id:String(680000000000000000n+BigInt(Date.now())*100n+BigInt(eventIndex)),token,application_id:client,type:3,
    guild_id:guild,channel_id:thread,member:{user:{id:who,username:accounts.get(who).name},roles:accounts.get(who).roles},
    message:{id:sourceParty.messageUrl.split('/').at(-1)},data:{custom_id:'wb:'+id+':'+(['leave','start'].includes(roleKey)?roleKey:hash(roleKey).slice(0,20))}};
  const payload=JSON.stringify(evt),stamp=String(Math.floor(Date.now()/1000));
  const signature=sign(null,Buffer.from(stamp+payload),privateKey).toString('hex');
  assert.equal((await ok(await nativeFetch(origin+'/api/discord/interactions',{method:'POST',headers:{'content-type':'application/json',
    'x-signature-timestamp':stamp,'x-signature-ed25519':signature},body:payload}))).type,5);
  for(let i=0;i<50&&!replies.has(token);i++) await pause(30);
  return replies.get(token);
}
await ok(await act(memberCookie,'join',{role:0}));
assert.match(await click(guest,'Tank'),/waitlist/);
await ok(await act(guest2Cookie,'waitlist',{role:0}));
let snapshot=await read();
assert.deepEqual(snapshot.waitlist.map(x=>x.name),['FriendlyGuest','SecondGuest']);
assert.ok(snapshot.waitlist.every(x=>x.signupId&&!x.offered&&!Object.hasOwn(x,'user')));
assert.ok(!Object.hasOwn(snapshot,'threadActivity'));
const card=()=>announcements.get(party.messageUrl.split('/').at(-1));
assert.match(card().embeds[0].description,/Waitlist/);
assert.match(card().embeds[0].description,new RegExp(guest));
assert.match(await click(guest,'Tank'),/left the waitlist/);
assert.match(await click(guest,'Tank'),/Added to/);
assert.deepEqual((await read()).waitlist.map(x=>x.name),['SecondGuest','FriendlyGuest']);
await ok(await act(memberCookie,'leave'));
snapshot=await read();
assert.deepEqual(snapshot.waitlist.map(x=>x.name),['FriendlyGuest']);
assert.deepEqual(snapshot.signups.map(x=>x.name),['SecondGuest']);
assert.equal((await act(adminCookie,'join',{role:0})).status,409);
const offer=[...announcements.values()].find(x=>x.embeds?.[0]?.description?.includes('was **automatically assigned** to **Tank**'));
assert.deepEqual(offer.allowed_mentions.users,[guest2]);
assert.deepEqual((await read()).signups.map(x=>x.name),['SecondGuest']);
assert.match(await click(guest2,'leave'),/released/);
assert.deepEqual((await read()).signups.map(x=>x.name),['FriendlyGuest']);
await ok(await act(guestCookie,'leave'));
assert.equal((await read()).waitlist.length,0);
await ok(await act(memberCookie,'join',{role:0}));
await ok(await act(guestCookie,'waitlist',{role:0}));
await ok(await act(guest2Cookie,'waitlist',{role:0}));
accounts.get(guest).roles=[];
await ok(await act(adminCookie,'remove-signup',{signupId:(await read()).signups[0].signupId}));
snapshot=await read();
assert.deepEqual(snapshot.waitlist,[]);
assert.deepEqual(snapshot.signups.map(x=>x.name),['SecondGuest']);
accounts.get(guest).roles=[guestRole];
const history=[...announcements.values()].map(x=>x.embeds?.[0]?.description||'').join('\n');
assert.match(history,new RegExp(member+'> left \\*\\*Tank\\*\\* · removed by <@'+admin));
assert.equal((await act(memberCookie,'start')).status,403);
assert.match(await click(member,'start'),/cannot perform/);
assert.match(await click(admin,'start'),/started/);
snapshot=await read();
assert.ok(snapshot.startedAt);
assert.equal((await act(memberCookie,'join',{role:1})).status,409);
assert.equal((await act(guest2Cookie,'leave')).status,409);
assert.equal((await act(guestCookie,'waitlist',{role:1})).status,409);
assert.equal((await act(adminCookie,'start')).status,409);
assert.ok(card().components.flatMap(x=>x.components).every(x=>x.disabled));
await ok(await act(adminCookie,'finish'));

const extra=await ok(await api('party',adminCookie,{...details,nonce:randomBytes(10).toString('hex')}));
await ok(await act(memberCookie,'join',{role:0},extra.id));
await ok(await act(guestCookie,'waitlist',{role:0},extra.id));
await ok(await act(guest2Cookie,'waitlist',{role:0},extra.id));
const removal=(await read(extra.id)).waitlist[0].signupId;
assert.equal((await act(guestCookie,'remove-waitlist',{signupId:removal},extra.id)).status,403);
await ok(await act(adminCookie,'remove-waitlist',{signupId:removal},extra.id));
await ok(await act(adminCookie,'remove-signup',{signupId:(await read(extra.id)).signups[0].signupId},extra.id));
assert.deepEqual((await read(extra.id)).signups.map(x=>x.name),['SecondGuest']);
await ok(await api('party',adminCookie,{...details,id:extra.id,action:'edit',roles:[{name:'Healer',count:1},{name:'Tank',count:1}]}));
assert.equal((await read(extra.id)).signups[0].role,1);
const races=await Promise.all([act(memberCookie,'join',{role:0},extra.id),act(guestCookie,'join',{role:0},extra.id)]);
assert.deepEqual(races.map(x=>x.status).sort(),[200,409]);
const twenty=await ok(await api('party',adminCookie,{...details,roles:Array.from({length:20},(_,i)=>({name:'Role '+i,count:1})),nonce:randomBytes(10).toString('hex')}));
assert.deepEqual(announcements.get(twenty.messageUrl.split('/').at(-1)).components.map(x=>x.components.length),[5,5,5,5,2]);
const nextFetch=globalThis.fetch;
let failHistory=true;
globalThis.fetch=async(input,options={})=>{
  const data=options.body&&typeof options.body==='string'?JSON.parse(options.body):null;
  if(failHistory&&new URL(input).hostname==='discord.com'&&options.method==='POST'&&data?.embeds?.[0]&&!data.embeds[0].title){
    return new Response('{}',{status:503});
  }
  return nextFetch(input,options);
};
await ok(await act(guest2Cookie,'leave',{},extra.id));
assert.ok(db.get(prefix+'parties').find(x=>x.id===extra.id).threadActivity.length);
failHistory=false;
await ok(await api('board',adminCookie));
assert.equal(db.get(prefix+'parties').find(x=>x.id===extra.id).threadActivity.length,0);
globalThis.fetch=nextFetch;
console.log('Automatic FIFO assignment, Discord toggle, eligibility recheck, organizer removals, role remap, concurrent claims, thread history and Start party locking verified.');
const organizerParty=await ok(await api('party',adminCookie,{...details,title:'Organizer visibility',guildOnly:true,nonce:randomBytes(10).toString('hex')}));
assert.ok(!(await ok(await api('board',guestCookie))).parties.some(p=>p.id===organizerParty.id));
assert.equal((await api('templates',guestCookie)).status,403);
accounts.get(guest).roles.push(organizerRole);
const guestOrganizerBoard=await ok(await api('board',guestCookie));
assert.equal(guestOrganizerBoard.canManage,true);
assert.equal(guestOrganizerBoard.canConfigure,false);
assert.ok(guestOrganizerBoard.parties.some(p=>p.id===organizerParty.id));
assert.equal((await ok(await api('party?id='+organizerParty.id,guestCookie))).party.id,organizerParty.id);
await ok(await api('templates',guestCookie,{...details,title:'Guest organizer template'}));
assert.ok((await ok(await api('templates',guestCookie))).some(t=>t.title==='Guest organizer template'));
assert.equal((await act(guestCookie,'join',{role:0},organizerParty.id)).status,403);
assert.equal((await act(guestCookie,'waitlist',{role:0},organizerParty.id)).status,403);
assert.match(await click(guest,'Tank',organizerParty.id,organizerParty),/exclusive/);
await ok(await act(memberCookie,'join',{role:0},organizerParty.id));
await ok(await act(guestCookie,'start',{},organizerParty.id));
accounts.get(guest).roles=accounts.get(guest).roles.filter(r=>r!==organizerRole);
assert.equal((await ok(await api('board',guestCookie))).canManage,false);
assert.ok(!(await ok(await api('board',guestCookie))).parties.some(p=>p.id===organizerParty.id));
assert.equal((await api('templates',guestCookie)).status,403);
assert.ok((await ok(await api('party?id='+organizerParty.id,guestCookie))).restricted);
console.log('Guest organizer visibility, templates, management, guild-only signup rejection and organizer role revocation verified.');

// Each role has an independent FIFO, even when another role's waiter joined first.
const independent=await ok(await api('party',adminCookie,{...details,title:'Independent queues',nonce:randomBytes(10).toString('hex')}));
await ok(await act(memberCookie,'join',{role:0},independent.id));
await ok(await act(adminCookie,'join',{role:1},independent.id));
await ok(await act(guestCookie,'waitlist',{role:1},independent.id));
await ok(await act(guest2Cookie,'waitlist',{role:0},independent.id));
await ok(await act(memberCookie,'leave',{},independent.id));
assert.deepEqual((await read(independent.id)).waitlist.map(x=>x.name),['FriendlyGuest']);
assert.ok((await read(independent.id)).signups.some(x=>x.name==='SecondGuest'&&x.role===0));
await ok(await act(adminCookie,'leave',{},independent.id));
assert.ok((await read(independent.id)).signups.some(x=>x.name==='FriendlyGuest'&&x.role===1));

// Promoting a player to a different role releases their old slot and promotes its queue too.
const cascade=await ok(await api('party',adminCookie,{...details,title:'Switch cascade',nonce:randomBytes(10).toString('hex')}));
await ok(await act(guest2Cookie,'join',{role:0},cascade.id));
await ok(await act(memberCookie,'join',{role:1},cascade.id));
await ok(await act(guest2Cookie,'waitlist',{role:1},cascade.id));
await ok(await act(guestCookie,'waitlist',{role:0},cascade.id));
await ok(await act(memberCookie,'leave',{},cascade.id));
const cascaded=await read(cascade.id);
assert.deepEqual(cascaded.waitlist,[]);
assert.ok(cascaded.signups.some(x=>x.name==='SecondGuest'&&x.role===1));
assert.ok(cascaded.signups.some(x=>x.name==='FriendlyGuest'&&x.role===0));
assert.equal(new Set(cascaded.signups.map(x=>x.name)).size,cascaded.signups.length);

// Extra capacity fills in order, including waitlists left by the old offer system.
const expanded=await ok(await api('party',adminCookie,{...details,title:'Expanded slots',nonce:randomBytes(10).toString('hex')}));
await ok(await act(memberCookie,'join',{role:0},expanded.id));
await ok(await act(guestCookie,'waitlist',{role:0},expanded.id));
await ok(await act(guest2Cookie,'waitlist',{role:0},expanded.id));
const legacyParties=await db.get(prefix+'parties');
legacyParties.find(x=>x.id===expanded.id).waitlist[0].offered=true;
await db.put(prefix+'parties',legacyParties);
await ok(await api('party',adminCookie,{...details,id:expanded.id,action:'edit',roles:[{name:'Tank',count:3},{name:'Healer',count:1}]}));
const expandedRoster=await read(expanded.id);
assert.deepEqual(expandedRoster.signups.map(x=>x.name),['DAGITMember','FriendlyGuest','SecondGuest']);
assert.deepEqual(expandedRoster.waitlist,[]);

// A direct claim racing a departure must not jump ahead of the queued player.
const racing=await ok(await api('party',adminCookie,{...details,title:'Queue priority race',nonce:randomBytes(10).toString('hex')}));
await ok(await act(memberCookie,'join',{role:0},racing.id));
await ok(await act(guestCookie,'waitlist',{role:0},racing.id));
const priorityRace=await Promise.all([act(memberCookie,'leave',{},racing.id),act(adminCookie,'join',{role:0},racing.id)]);
assert.equal(priorityRace[0].status,200);assert.equal(priorityRace[1].status,409);
assert.deepEqual((await read(racing.id)).signups.map(x=>x.name),['FriendlyGuest']);

// Transient lookup errors preserve priority; maintenance retries after recovery.
const retrying=await ok(await api('party',adminCookie,{...details,title:'Retry FIFO',nonce:randomBytes(10).toString('hex')}));
await ok(await act(memberCookie,'join',{role:0},retrying.id));
await ok(await act(guestCookie,'waitlist',{role:0},retrying.id));
await ok(await act(guest2Cookie,'waitlist',{role:0},retrying.id));
const workingFetch=globalThis.fetch;
let lookupStatus=503;
globalThis.fetch=async(input,options={})=>new URL(input).pathname.endsWith('/members/'+guest)?new Response('{}',{status:lookupStatus}):workingFetch(input,options);
await ok(await act(memberCookie,'leave',{},retrying.id));
assert.deepEqual((await read(retrying.id)).waitlist.map(x=>x.name),['FriendlyGuest','SecondGuest']);
assert.equal((await act(adminCookie,'join',{role:0},retrying.id)).status,409);
lookupStatus=403;
await ok(await api('board',adminCookie));
assert.deepEqual((await read(retrying.id)).waitlist.map(x=>x.name),['FriendlyGuest','SecondGuest']);
assert.deepEqual((await read(retrying.id)).signups,[]);
globalThis.fetch=workingFetch;
await ok(await api('board',adminCookie));
assert.deepEqual((await read(retrying.id)).signups.map(x=>x.name),['FriendlyGuest']);
assert.deepEqual((await read(retrying.id)).waitlist.map(x=>x.name),['SecondGuest']);
const retryCard=announcements.get(retrying.messageUrl.split('/').at(-1));
assert.match(retryCard.embeds[0].description,new RegExp('Tank - 1/1 \\| <@'+guest+'>'));
assert.match(retryCard.embeds[0].description,new RegExp('Waitlist · 1. <@'+guest2+'>'));
assert.ok(!retryCard.embeds[0].description.includes('offered'));
console.log('Per-role FIFO, cascade switches, legacy offers, capacity increases, concurrent claims and transient recovery verified.');
await new Promise(resolve=>server.close(resolve));
for(const [key] of await rawDb.entries(testNamespace+':'))await rawDb.remove(key);


