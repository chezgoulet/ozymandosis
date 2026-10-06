// SPDX-License-Identifier: AGPL-3.0-only
// One tiny query interface over two engines: node-postgres against a real
// server in production, and PGlite (Postgres compiled to WASM, in process) for
// local development and tests. Same SQL, same migrations.
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'pg' | 'pglite';
}

export async function openDb(opts: { url?: string; dir?: string }): Promise<Db> {
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url, max: 12, idleTimeoutMillis: 30000 });
    pool.on('error', err => console.error('postgres pool error', err.message));
    const wrap = (q: { query: pg.Pool['query'] }): Omit<Db, 'tx' | 'close' | 'kind'> => ({
      async query(sql, params) { return (await q.query(sql, params as any[])).rows; },
      async one(sql, params) { return (await q.query(sql, params as any[])).rows[0] ?? null; },
    });
    const base = wrap(pool);
    return {
      ...base, kind: 'pg',
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const inner: Db = { ...wrap(client as any), kind: 'pg', tx: f => f(inner), close: async () => {} };
          const r = await fn(inner);
          await client.query('commit');
          return r;
        } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite(opts.dir);
  await lite.waitReady;
  let chain: Promise<unknown> = Promise.resolve();
  const q = async (sql: string, params?: unknown[]) => (await lite.query(sql, params as any[])).rows as any[];
  const db: Db = {
    kind: 'pglite',
    query: q,
    async one(sql, params) { return (await q(sql, params))[0] ?? null; },
    // PGlite is single-connection: serialise transactions so they never interleave
    tx(fn) {
      const run = chain.then(() => lite.transaction(async t => {
        const inner: Db = { kind: 'pglite', query: async (s, p) => (await t.query(s, p as any[])).rows as any[], one: async (s, p) => ((await t.query(s, p as any[])).rows[0] as any) ?? null, tx: f => f(inner), close: async () => {} };
        return fn(inner);
      }));
      chain = run.catch(() => {});
      return run as any;
    },
    close: () => lite.close(),
  };
  return db;
}

// Apply every migrations/NNN_*.sql not yet recorded, in order, each in a transaction.
export async function migrate(db: Db, log: (s: string) => void = () => {}): Promise<number> {
  await db.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = [join(here, 'migrations'), join(here, '../../src/db/migrations')].find(d => { try { readdirSync(d); return true; } catch { return false; } });
  if (!dir) throw new Error('migrations directory not found');
  const done = new Set((await db.query<{ version: string }>('select version from schema_migrations')).map(r => r.version));
  let n = 0;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await db.tx(async t => {
      for (const stmt of splitSql(sql)) await t.query(stmt);
      await t.query('insert into schema_migrations (version) values ($1)', [f]);
    });
    log(`migrated ${f}`); n++;
  }
  return n;
}
// Split on semicolons that end a statement (no procedural bodies in our migrations).
function splitSql(sql: string): string[] {
  return sql.replace(/--[^\n]*/g, '').split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}
