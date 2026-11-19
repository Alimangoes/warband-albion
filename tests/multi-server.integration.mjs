import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
const origin='http://127.0.0.1:4396';
const alpha='110000000000000001',beta='1395017853203255429',foreign='110000000000000009';
const admin='110000000000000010',single='110000000000000011',client='110000000000000020',botId='110000000000000021';
const channelA='110000000000000030',channelB='110000000000000031';
const councilA='110000000000000040',councilB='110000000000000041';
const namespace='test-multiserver-'+Date.now();
const openServers=process.argv.includes('--open-servers');
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
Object.assign(process.env,{APP_URL:origin,DEMO_MODE:'false',VERCEL:'',MULTI_SERVER_MODE:'true',DATA_NAMESPACE:namespace,
  DISCORD_ALLOWED_GUILD_IDS:openServers?'':alpha+','+beta,DISCORD_GUILD_ID:alpha,DISCORD_CLIENT_ID:client,
  DISCORD_CLIENT_SECRET:'local-fixture',DISCORD_BOT_TOKEN:'local-fixture',
  DISCORD_PUBLIC_KEY:publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex')});
delete process.env.DATABASE_URL;delete process.env.POSTGRES_URL;
const nativeFetch=globalThis.fetch;
const commands=[],messages=[],replies=new Map();
let botGuildReads=0,memberReads=0;
let betaAccess=true;
globalThis.fetch=async(input,options={})=>{
  const url=new URL(input);
  if(url.origin===origin)return nativeFetch(input,options);
  const path=url.pathname,json=(value,status=200)=>new Response(JSON.stringify(value),{status});
  assert.equal(url.hostname,'discord.com');
  const auth=options.headers?.Authorization;
  if(path==='/api/oauth2/token')return json({access_token:options.body.get('code')});
  if(path==='/api/v10/users/@me')return json({id:auth==='Bot local-fixture'?botId:auth.split(' ')[1],username:'Organizer'});
  if(path==='/api/v10/users/@me/guilds'){if(auth==='Bot local-fixture')botGuildReads++;return json((auth==='Bearer '+single?[alpha]:[alpha,beta,foreign]).map(id=>({id,name:id===alpha?'Alpha':id===beta?'Beta':'New Server',permissions:'8',owner:true})));}
  const guildMatch=/\/guilds\/(\d+)/.exec(path),guild=guildMatch?.[1];
  if(path==='/api/v10/guilds/'+guild)return json({id:guild,name:guild===alpha?'Alpha':'Beta',owner_id:admin});
  if(path.endsWith('/roles'))return json([{id:guild,name:'@everyone',permissions:'68608'},
    {id:guild===alpha?councilA:councilB,name:guild===alpha?'Alpha Council':'Beta Council',permissions:'8',position:2}]);
  if(path.endsWith('/channels'))return json([{id:guild===alpha?channelA:channelB,name:guild===alpha?'alpha-parties':'beta-parties',type:0,permission_overwrites:[]}]);
  const member=/\/members\/(\d+)$/.exec(path)?.[1];
  if(member){memberReads++;if(guild===beta&&!betaAccess&&member===admin)return json({},404);
    return json({user:{id:member,username:'Organizer',discriminator:'0'},nick:'Organizer',roles:[guild===alpha?councilA:councilB]});}
  if(path.includes('/commands')){if(options.method==='POST')commands.push({guild,data:JSON.parse(options.body)});return json(options.method==='GET'?[]:{});}
  if(path.includes('/messages/@original')){replies.set(path.split('/')[5],JSON.parse(options.body).content);return json({});}
  const destination=/\/channels\/(\d+)\/messages(?:\/(\d+))?$/.exec(path);
  if(destination){const id=destination[2]||String(110000000000000100n+BigInt(messages.length));messages.push({channel:destination[1],data:JSON.parse(options.body)});return json({id});}
  throw Error('Unexpected mocked request '+path);
};
const {handleRequest}=await import(pathToFileURL(resolve('server.mjs')));
const {openSQLite,namespaceStore}=await import(pathToFileURL(resolve('storage.mjs')));
const raw=openSQLite(),db=namespaceStore(raw,namespace);
raw.put(alpha+':settings',{productionSentinel:true});
for(const [guild,channel,role]of[[alpha,channelA,councilA],[beta,channelB,councilB]]){
  await db.put(guild+':settings',{channelId:channel,channel:guild===alpha?'alpha-parties':'beta-parties',channelType:0,roleId:role,region:'asia'});
  await db.put(guild+':character:'+admin,{id:'player-'+guild,name:'IGN-'+guild,region:'asia',guild:'',guildId:''});
  await db.put(guild+':expertise:'+admin,['tank']);
}
const server=http.createServer(handleRequest);await new Promise(resolve=>server.listen(4396,'127.0.0.1',resolve));
const req=(path,cookie,data)=>nativeFetch(origin+path,{headers:{...(cookie?{cookie}:{}),...(data?{origin,'content-type':'application/json'}:{})},
  ...(data?{method:'POST',body:JSON.stringify(data)}:{}),redirect:'manual'});
const ok=async response=>{const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
async function login(who){const first=await req('/auth/discord');assert.match(new URL(first.headers.get('location')).searchParams.get('scope'),/guilds/);
  const state=new URL(first.headers.get('location')).searchParams.get('state');
  const callback=await req('/auth/discord/callback?state='+state+'&code='+who,first.headers.getSetCookie()[0].split(';')[0]);
  assert.equal(callback.headers.get('location'),who===single?'/?server='+alpha:'/');return callback.headers.getSetCookie().find(x=>x.startsWith('albion_session=')).split(';')[0];}
const a=await login(admin),b=await login(admin),onlyA=await login(single);
const initial=await ok(await req('/api/board',a));assert.equal(initial.onboarding,'workspace');assert.equal(initial.workspaces.length,openServers?3:2);
const singleBoard=await ok(await req('/api/board',onlyA));assert.equal(singleBoard.workspaceId,alpha);assert.notEqual(singleBoard.onboarding,'workspace');
assert.equal(singleBoard.canSwitchWorkspace,false);
assert.equal((await req('/api/workspaces',onlyA,{id:beta})).status,403);
await ok(await req('/api/workspaces',a,{id:alpha}));await ok(await req('/api/workspaces',b,{id:beta}));
assert.equal((await ok(await req('/api/board',a))).canSwitchWorkspace,true);
const payload={title:'Alpha only party',type:'PvE',zone:'Thetford',waitUntilFull:true,roles:[{name:'Tank',count:1}],nonce:randomBytes(10).toString('hex')};
const partyA=await ok(await req('/api/party',a,payload)),partyB=await ok(await req('/api/party',b,{...payload,title:'Beta only party',nonce:randomBytes(10).toString('hex')}));
assert.match(partyB.messageUrl,new RegExp('/'+beta+'/'));
assert.equal((await req('/api/party?id='+partyA.id,b)).status,404);
assert.equal((await req('/api/party/action',a,{id:partyB.id,action:'delete'})).status,404);
await ok(await req('/api/templates',a,{...payload,title:'Alpha template'}));
const betaTemplate=await ok(await req('/api/templates',b,{...payload,title:'Beta template'}));
const templateFile={format:'warband-template',version:1,template:{...betaTemplate,id:'untrusted-source-id',mentionRoleIds:[councilB]}};
const imported=await ok(await req('/api/templates',a,{action:'import-preview',file:templateFile}));
assert.equal(imported.title,'Beta template');assert.equal(imported.id,undefined);assert.deepEqual(imported.mentionRoleIds,[]);
assert.equal((await ok(await req('/api/templates',a))).length,1,'Import preview must not save');
assert.equal((await req('/api/templates',a,{action:'import-preview',file:{...templateFile,version:99}})).status,400);
assert.equal((await req('/api/templates',a,{action:'import-preview',file:{...templateFile,template:{...betaTemplate,roles:[{name:'Tank',count:99}]}}})).status,400);
assert.equal((await req('/api/templates',undefined,{action:'import-preview',file:templateFile})).status,401);
assert.deepEqual((await ok(await req('/api/templates',a))).map(x=>x.title),['Alpha template']);
assert.deepEqual((await ok(await req('/api/templates',b))).map(x=>x.title),['Beta template']);
const memberBaseline=memberReads,metadataBaseline=botGuildReads;
const timings=[];
const boards=await Promise.all(Array.from({length:40},async(_,i)=>{const start=performance.now();const result=await ok(await req('/api/board?server='+beta,i%2?a:b));timings.push(performance.now()-start);return result;}));
boards.forEach((board,i)=>{assert.equal(board.workspaceId,i%2?alpha:beta);assert.ok(board.parties.every(party=>party.title.startsWith(i%2?'Alpha':'Beta')));});
assert.equal(botGuildReads,1,'Bot guild list should be shared across requests');
assert.equal(memberReads-memberBaseline,40,'Every request must check membership live');
console.log(JSON.stringify({syntheticConcurrentBoardRequests:40,liveMemberChecks:memberReads-memberBaseline,
  additionalBotGuildListReads:botGuildReads-metadataBaseline,p95LocalMockedMs:Math.round(timings.sort((a,b)=>a-b)[37])}));
assert.deepEqual((await ok(await req('/api/options',a))).channels.map(x=>x.id),[channelA]);
assert.deepEqual((await ok(await req('/api/options',b))).channels.map(x=>x.id),[channelB]);
const event={id:String(690000000000000000n+BigInt(Date.now())),token:'multi-beta-command',application_id:client,type:2,guild_id:beta,
  member:{user:{id:admin,username:'Organizer'},roles:[councilB]},data:{name:'warband',type:1,options:[{name:'template',value:betaTemplate.id}]}};
async function signed(evt){const payload=JSON.stringify(evt),stamp=String(Math.floor(Date.now()/1000));const signature=sign(null,Buffer.from(stamp+payload),privateKey).toString('hex');
  return nativeFetch(origin+'/api/discord/interactions',{method:'POST',headers:{'content-type':'application/json','x-signature-timestamp':stamp,'x-signature-ed25519':signature},body:payload});}
assert.equal((await ok(await signed(event))).type,5);for(let i=0;i<50&&!replies.has(event.token);i++)await pause(30);
assert.match(replies.get(event.token),/Published.*Beta template/);
if(openServers){
  const fresh=await login(admin);
  await ok(await req('/api/workspaces',fresh,{id:foreign}));
  const freshBoard=await ok(await req('/api/board',fresh));
  assert.equal(freshBoard.workspaceId,foreign);assert.equal(freshBoard.canConfigure,true);assert.deepEqual(freshBoard.parties,[]);
  assert.deepEqual(await ok(await req('/api/templates',fresh)),[]);
  assert.equal((await req('/api/party?id='+partyA.id,fresh)).status,404);
  assert.equal((await ok(await signed({...event,guild_id:foreign,data:{name:'help',type:1}}))).type,4);
}else assert.equal((await signed({...event,guild_id:foreign})).status,403);
assert.ok(commands.some(x=>x.guild===alpha));assert.ok(commands.some(x=>x.guild===beta));
assert.equal((await db.entries(beta+':parties')).length,1);
assert.deepEqual(raw.get(alpha+':settings'),{productionSentinel:true});
betaAccess=false;assert.equal((await req('/api/board',b)).status,403);
const alphaSettings=await db.get(alpha+':settings');
await db.put(alpha+':settings',{...alphaSettings,requireLoginRole:true,loginRoleIds:['110000000000000099']});
const deniedStart=await req('/auth/discord');
const deniedState=new URL(deniedStart.headers.get('location')).searchParams.get('state');
const deniedLogin=await req('/auth/discord/callback?state='+deniedState+'&code='+single,deniedStart.headers.getSetCookie()[0].split(';')[0]);
assert.equal(new URL(deniedLogin.headers.get('location'),origin).searchParams.get('login'),'role');
assert.ok(!deniedLogin.headers.getSetCookie().some(cookie=>cookie.startsWith('albion_session=')));
await db.put(alpha+':settings',alphaSettings);
console.log('Two-server OAuth, selection, concurrent request isolation, parties, templates, channels, commands, membership revocation, allowed-server checks and preview database namespace verified.');
console.log(openServers?'Open enrollment: new third server can set up its own empty workspace; existing data stays isolated.':'Restricted enrollment: allowlist continues to reject unapproved servers.');
await new Promise(resolve=>server.close(resolve));
for(const [key]of await raw.entries(namespace+':'))await raw.remove(key);
await raw.remove(alpha+':settings');
