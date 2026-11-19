import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

export function namespaceStore(store, namespace) {
  if (!namespace) return store;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)) throw new Error('Invalid database namespace.');
  const prefix = namespace + ':';
  return {
    get: (key, ...args) => store.get(prefix + key, ...args),
    put: (key, ...args) => store.put(prefix + key, ...args),
    remove: key => store.remove(prefix + key),
    take: key => store.take(prefix + key),
    change: (key, ...args) => store.change(prefix + key, ...args),
    entries: async key => (await store.entries(prefix + key)).map(([key, value]) => [key.slice(prefix.length), value]),
    removePair: (first, second) => store.removePair(prefix + first, prefix + second),
    removeRoleSelection: (key, ...args) => store.removeRoleSelection(prefix + key, ...args),
    linkCharacter: (key, record, ...args) => store.linkCharacter(prefix + key, prefix + record, ...args),
    sweep: store.sweep,
    ...(store.limit ? { limit: (key, ...args) => store.limit(prefix + key, ...args) } : {})
  };
}

const schema = 'CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires BIGINT)';
const select = 'SELECT value FROM records WHERE key=$1 AND (expires IS NULL OR expires>$2)';
const selectPrefix = "SELECT key,value FROM records WHERE key LIKE $1 ESCAPE '!' AND (expires IS NULL OR expires>$2)";
const prefixPattern = prefix => prefix.replace(/[!_%]/g, char => '!' + char) + '%';
const upsert = 'INSERT INTO records (key,value,expires) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires';
const consume = 'DELETE FROM records WHERE key=$1 AND expires>$2 RETURNING value';
const sweep = 'DELETE FROM records WHERE expires<=$1';
const decode = (row, fallback) => row ? JSON.parse(row.value) : fallback;
const roleSelections = (rows, name) => rows.flatMap(row => {
  const selected = decode(row);
  return Array.isArray(selected) && selected.includes(name)
    ? [[row.key, JSON.stringify(selected.filter(role => role !== name))]] : [];
});
const characterConflict = (rows, key, character) => rows.some(row => {
  if (row.key === key) return false;
  const existing = decode(row);
  return existing?.region === character.region && existing.id === character.id;
});

export function openSQLite() {
  mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
  const db = new DatabaseSync(fileURLToPath(new URL('./data/board.sqlite', import.meta.url)));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; ' + schema);
  const read = db.prepare(select.replaceAll(/\$\d/g, '?'));
  const readPrefix = db.prepare(selectPrefix.replaceAll(/\$\d/g, '?'));
  const write = db.prepare(upsert.replaceAll(/\$\d/g, '?'));
  const remove = db.prepare('DELETE FROM records WHERE key=?');
  const removePair = db.prepare('DELETE FROM records WHERE key IN (?, ?)');
  const updateValue = db.prepare('UPDATE records SET value=? WHERE key=?');
  const take = db.prepare(consume.replaceAll(/\$\d/g, '?'));
  const prune = db.prepare(sweep.replace('$1', '?'));
  const get = (key, fallback = null) => decode(read.get(key, Date.now()), fallback);
  const put = (key, value, expires = null) => write.run(key, JSON.stringify(value), expires);
  return {
    get, put, remove: key => remove.run(key),
    removePair: (first, second) => removePair.run(first, second),
    removeRoleSelection(prefix, name) {
      transaction(() => {
        for (const [key, value] of roleSelections(readPrefix.all(prefixPattern(prefix), Date.now()), name)) {
          updateValue.run(value, key);
        }
      });
    },
    entries: prefix => readPrefix.all(prefixPattern(prefix), Date.now()).map(row => [row.key, decode(row)]),
    take: key => decode(take.get(key, Date.now()), null),
    sweep: () => prune.run(Date.now()),
    linkCharacter(prefix, key, character, expires) {
      return transaction(() => {
        if (characterConflict(readPrefix.all(prefixPattern(prefix), Date.now()), key, character)) return false;
        put(key, character, expires);
        return true;
      });
    },
    change(key, fallback, expires, edit) {
      return transaction(() => {
        const value = get(key, fallback);
        const result = edit(value);
        put(key, value, expires);
        return result;
      });
    }
  };
  function transaction(run) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function openPostgres(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000, allowExitOnIdle: true, statement_timeout: 8000 });
  pool.on('error', () => console.error('Warband database connection closed unexpectedly.'));
  let setup;
  const ready = () => setup ||= initialize().catch(error => {
    setup = undefined;
    throw error;
  });
  async function initialize() {
    // Serializes first-time schema creation across cold starts.
    await transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(1771318924, 1)');
      await db.query(schema);
    });
  }
  async function transaction(run) {
    const db = await pool.connect();
    let discard = false;
    try {
      await db.query('BEGIN');
      const result = await run(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => { discard = true; });
      throw error;
    } finally {
      db.release(discard);
    }
  }
  async function query(sql, values) {
    await ready();
    return pool.query(sql, values);
  }
  return {
    async get(key, fallback = null) {
      return decode((await query(select, [key, Date.now()])).rows[0], fallback);
    },
    async entries(prefix) {
      const { rows } = await query(selectPrefix, [prefixPattern(prefix), Date.now()]);
      return rows.map(row => [row.key, decode(row)]);
    },
    put: (key, value, expires = null) => query(upsert, [key, JSON.stringify(value), expires]),
    remove: key => query('DELETE FROM records WHERE key=$1', [key]),
    removePair: (first, second) => query('DELETE FROM records WHERE key IN ($1, $2)', [first, second]),
    async removeRoleSelection(prefix, name) {
      await ready();
      await transaction(async db => {
        const { rows } = await db.query(selectPrefix + ' FOR UPDATE', [prefixPattern(prefix), Date.now()]);
        for (const [key, value] of roleSelections(rows, name)) {
          await db.query('UPDATE records SET value=$1 WHERE key=$2', [value, key]);
        }
      });
    },
    async linkCharacter(prefix, key, character, expires) {
      await ready();
      return transaction(async db => {
        // Lock the scope so older links are checked alongside concurrent claims.
        await db.query('SELECT pg_advisory_xact_lock(1771318925, hashtext($1))', [prefix]);
        const { rows } = await db.query(selectPrefix, [prefixPattern(prefix), Date.now()]);
        if (characterConflict(rows, key, character)) return false;
        await db.query(upsert, [key, JSON.stringify(character), expires]);
        return true;
      });
    },
    async take(key) {
      return decode((await query(consume, [key, Date.now()])).rows[0], null);
    },
    sweep: () => query(sweep, [Date.now()]),
    async limit(key, now, expires, max) {
      const result = await query(`
        INSERT INTO records (key,value,expires) VALUES ($1,'1',$3)
        ON CONFLICT(key) DO UPDATE SET
          value=CASE WHEN records.expires<=$2 THEN '1' ELSE (records.value::integer+1)::text END,
          expires=CASE WHEN records.expires<=$2 THEN excluded.expires ELSE records.expires END
        WHERE records.expires<=$2 OR records.value::integer<$4
      `, [key, now, expires, max]);
      return result.rowCount > 0;
    },
    async change(key, fallback, expires = null, edit) {
      await ready();
      return transaction(async db => {
        await db.query('SELECT pg_advisory_xact_lock(1771318925, hashtext($1))', [key]);
        const { rows } = await db.query(select + ' FOR UPDATE', [key, Date.now()]);
        const value = decode(rows[0], fallback);
        const result = edit(value);
        await db.query(upsert, [key, JSON.stringify(value), expires]);
        return result;
      });
    }
  };
}
