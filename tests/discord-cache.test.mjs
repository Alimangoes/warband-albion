import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { createDiscordDataCache } from '../discord-cache.mjs';

function store() {
  const records = new Map();
  return {
    records,
    get: async key => structuredClone(records.get(key)),
    change: async (key, fallback, _expires, edit) => {
      const value = structuredClone(records.get(key) ?? fallback);
      const result = edit(value);
      records.set(key, value);
      return result;
    }
  };
}

test('40 concurrent readers across four instances share one upstream read', async () => {
  const db = store();
  const instances = Array.from({length: 4}, () => createDiscordDataCache({ db, clientId: 'app-a' }));
  let calls = 0;
  const fetchValue = async () => { calls++; await pause(20); return [{id: 'guild-a'}]; };
  await Promise.all(Array.from({length: 40}, fetchValue));
  const baseline = calls;
  calls = 0;
  const values = await Promise.all(Array.from({length: 40}, (_, i) => instances[i % 4]('guilds', 15000, fetchValue)));
  assert.equal(calls, 1);
  assert.ok(values.every(value => value[0].id === 'guild-a'));
  values[0][0].id = 'mutated';
  assert.equal(values[1][0].id, 'guild-a');
  assert.equal((await instances[0]('guilds', 15000, fetchValue))[0].id, 'guild-a');
  console.info(`Synthetic upstream read comparison: ${baseline} uncached -> ${calls} cached (40 reads, 4 instances).`);
});

test('expiry refreshes and application identities are isolated', async () => {
  const db = store(); let clock = 1000, calls = 0;
  const a = createDiscordDataCache({db, clientId: 'app-a', now: () => clock});
  const b = createDiscordDataCache({db, clientId: 'app-b', now: () => clock});
  const fetchValue = async () => ({id: ++calls});
  assert.equal((await a('identity', 100, fetchValue)).id, 1);
  assert.equal((await a('identity', 100, fetchValue)).id, 1);
  assert.equal((await b('identity', 100, fetchValue)).id, 2);
  clock += 101;
  assert.equal((await a('identity', 100, fetchValue)).id, 3);
});

test('failures are not cached and permissions cannot enter this cache', async () => {
  const db = store();
  const read = createDiscordDataCache({db, clientId: 'app-a'});
  await assert.rejects(read('guilds', 15000, async () => { throw new Error('upstream unavailable'); }), /upstream unavailable/);
  assert.deepEqual(await read('guilds', 15000, async () => []), []);
  await assert.rejects(read('member-permissions', 15000, async () => true), /Unsupported/);
});

test('an abandoned refresh lease recovers after expiry and waits are bounded', async () => {
  const db = store(); let clock = 1000;
  db.records.set('discord-metadata:app-a:guilds', {owner: 'dead-instance', leaseUntil: 1100});
  const read = createDiscordDataCache({db, clientId: 'app-a', now: () => clock, pause: async ms => {clock += ms;}});
  assert.deepEqual(await read('guilds', 15000, async () => ['recovered']), ['recovered']);
  db.records.set('discord-metadata:app-b:guilds', {owner: 'dead-instance', leaseUntil: 99999});
  const blocked = createDiscordDataCache({db, clientId: 'app-b', now: () => clock, waitMs: 100, pause: async ms => {clock += ms;}});
  await assert.rejects(blocked('guilds', 15000, async () => []), error => error.status === 503);
});

test('late refreshes cannot overwrite a newer lease owner', async () => {
  const db = store();
  const read = createDiscordDataCache({db, clientId: 'app-a'});
  await read('guilds', 15000, async () => {
    db.records.set('discord-metadata:app-a:guilds', {owner: 'new-instance', value: ['new'], freshUntil: Date.now()+15000});
    return ['old'];
  });
  assert.deepEqual((await db.get('discord-metadata:app-a:guilds')).value, ['new']);
});
