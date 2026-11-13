import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const schema = 'CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires BIGINT)';
const select = 'SELECT value FROM records WHERE key=$1 AND (expires IS NULL OR expires>$2)';
const upsert = 'INSERT INTO records (key,value,expires) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires';
const consume = 'DELETE FROM records WHERE key=$1 AND expires>$2 RETURNING value';
const sweep = 'DELETE FROM records WHERE expires<=$1';
const decode = (row, fallback) => row ? JSON.parse(row.value) : fallback;

export function openSQLite() {
  mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
  const db = new DatabaseSync(fileURLToPath(new URL('./data/board.sqlite', import.meta.url)));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; ' + schema);
  const read = db.prepare(select.replaceAll(/\$\d/g, '?'));
  const write = db.prepare(upsert.replaceAll(/\$\d/g, '?'));
  const remove = db.prepare('DELETE FROM records WHERE key=?');
  const take = db.prepare(consume.replaceAll(/\$\d/g, '?'));
  const prune = db.prepare(sweep.replace('$1', '?'));
  const get = (key, fallback = null) => decode(read.get(key, Date.now()), fallback);
  const put = (key, value, expires = null) => write.run(key, JSON.stringify(value), expires);
  return {
    get, put, remove: key => remove.run(key),
    take: key => decode(take.get(key, Date.now()), null),
    sweep: () => prune.run(Date.now()),
    change(key, fallback, expires, edit) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = get(key, fallback);
        const result = edit(value);
        put(key, value, expires);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
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
    put: (key, value, expires = null) => query(upsert, [key, JSON.stringify(value), expires]),
    remove: key => query('DELETE FROM records WHERE key=$1', [key]),
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
