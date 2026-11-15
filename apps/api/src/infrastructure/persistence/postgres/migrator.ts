import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlPool } from './pgClient.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies pending *.sql files in name order, each in its own transaction. */
export async function migrate(pool: SqlPool, log: (msg: string) => void = () => {}): Promise<string[]> {
  const conn = await pool.connect();
  const applied: string[] = [];
  try {
    await conn.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    await conn.query('alter table schema_migrations enable row level security');
    const done = new Set((await conn.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await conn.query('begin');
      try {
        await conn.exec(sql);
        await conn.query('insert into schema_migrations (name) values ($1)', [file]);
        await conn.query('commit');
      } catch (e) {
        await conn.query('rollback');
        throw e;
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    conn.release();
  }
  return applied;
}
