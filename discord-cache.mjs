import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Problem } from './providers.mjs';

// Cache bot metadata only. Callers must keep membership and permission checks live.
export function createDiscordDataCache({ db, clientId, now = Date.now, pause = delay,
  leaseMs = 30000, waitMs = 8500 }) {
  const pending = new Map();
  const resources = new Set(['identity', 'guilds']);
  return async function cached(resource, ttlMs, fetchValue) {
    if (!resources.has(resource)) throw new Error('Unsupported Discord cache resource.');
    if (pending.has(resource)) return structuredClone(await pending.get(resource));
    const work = read(resource, ttlMs, fetchValue);
    pending.set(resource, work);
    try { return structuredClone(await work); }
    finally { if (pending.get(resource) === work) pending.delete(resource); }
  };
  async function read(resource, ttlMs, fetchValue) {
    const key = 'discord-metadata:' + clientId + ':' + resource;
    const owner = randomBytes(16).toString('hex');
    const deadline = now() + waitMs;
    let attempt = 0;
    while (true) {
      const saved = await db.get(key);
      if (saved?.freshUntil > now()) return saved.value;
      const claimed = await db.change(key, {}, now() + Math.max(ttlMs, leaseMs) * 2, state => {
        if (state.freshUntil > now() || state.leaseUntil > now()) return false;
        state.owner = owner;
        state.leaseUntil = now() + leaseMs;
        return true;
      });
      if (claimed) {
        try {
          const value = await fetchValue();
          await db.change(key, {}, now() + ttlMs + leaseMs, state => {
            if (state.owner !== owner) return;
            state.value = value;
            state.freshUntil = now() + ttlMs;
            delete state.owner;
            delete state.leaseUntil;
          });
          return value;
        } catch (error) {
          await db.change(key, {}, now() + leaseMs, state => {
            if (state.owner === owner) {
              delete state.owner;
              delete state.leaseUntil;
            }
          });
          throw error;
        }
      }
      if (now() >= deadline) throw new Problem(503, 'Discord server data is refreshing. Try again shortly.');
      await pause(Math.min(100 * 2 ** attempt++, 500, Math.max(1, deadline - now())));
    }
  }
}
