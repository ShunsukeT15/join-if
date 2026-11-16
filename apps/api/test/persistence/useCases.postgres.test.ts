import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrator.js';
import { PostgresUnitOfWork } from '../../src/infrastructure/persistence/postgres/postgresUnitOfWork.js';
import { pglitePool } from '../support/pglite.js';
import { defineUseCaseSuite } from '../support/useCaseSuite.js';

const db = new PGlite();
const pool = pglitePool(db);
const ready = migrate(pool);

afterAll(() => pool.end());

async function freshUow() {
  await ready;
  const conn = await pool.connect();
  try {
    await conn.query('truncate rooms cascade');
  } finally {
    conn.release();
  }
  return new PostgresUnitOfWork(pool);
}

// The same behavioural suite as the memory adapter: the adapter contract test.
defineUseCaseSuite('postgres(pglite)', freshUow);

describe('postgres schema constraints (defence in depth)', () => {
  const exec = async (sql: string, params?: unknown[]) => {
    const conn = await pool.connect();
    try {
      return await conn.query(sql, params);
    } finally {
      conn.release();
    }
  };
  const seedRoom = async (id: string) => {
    await freshUow();
    await exec(
      `insert into rooms (id, title, status, admin_token_hash, created_at, purge_after) values ($1, 't', 'open', $2, now(), now() + interval '1 year')`,
      [id, `h-${id}`],
    );
  };
  const addMember = (roomId: string, n: number) =>
    exec(
      `insert into members (id, room_id, display_name, invite_token_hash, sort_order, created_at) values (gen_random_uuid(), $1, $2, $3, $4, now()) returning id`,
      [roomId, `m${n}`, `inv-${roomId}-${n}`, n],
    );

  it('re-running migrations is a no-op', async () => {
    await ready;
    expect(await migrate(pool)).toEqual([]);
  });

  it('rejects the 101st member via trigger', async () => {
    await seedRoom('r1');
    for (let i = 0; i < 100; i++) await addMember('r1', i);
    await expect(addMember('r1', 100)).rejects.toThrow(/member limit/);
  });

  const insertAnswer = (memberId: string, choice: string, patterns: unknown) =>
    exec(`insert into answers (member_id, choice, cond_patterns, updated_at) values ($1, $2, $3::jsonb, now())`, [
      memberId,
      choice,
      JSON.stringify(patterns),
    ]);

  it('rejects cond answers without patterns, or with an empty pattern', async () => {
    await seedRoom('r2');
    const id = ((await addMember('r2', 1)).rows[0] as { id: string }).id;
    await expect(insertAnswer(id, 'cond', [])).rejects.toThrow();
    await expect(insertAnswer(id, 'cond', [{ people: [], need: 0, minTotal: 0 }])).rejects.toThrow(/needs a person or headcount/);
    await expect(insertAnswer(id, 'yes', [{ people: [], need: 0, minTotal: 1 }])).rejects.toThrow();
    await expect(insertAnswer(id, 'cond', Array.from({ length: 6 }, () => ({ people: [], need: 0, minTotal: 1 })))).rejects.toThrow();
  });

  it('rejects pattern people from another room or self, and N out of range', async () => {
    await seedRoom('r3');
    await exec(
      `insert into rooms (id, title, status, admin_token_hash, created_at, purge_after) values ('r4', 't', 'open', 'h-r4', now(), now())`,
    );
    const me = ((await addMember('r3', 1)).rows[0] as { id: string }).id;
    const mate = ((await addMember('r3', 2)).rows[0] as { id: string }).id;
    const other = ((await addMember('r4', 1)).rows[0] as { id: string }).id;
    const ok = { people: [mate], need: 1, minTotal: 0 };
    await expect(insertAnswer(me, 'cond', [ok, { people: [other], need: 1, minTotal: 0 }])).rejects.toThrow(/same room/);
    await expect(insertAnswer(me, 'cond', [ok, { people: [me], need: 1, minTotal: 0 }])).rejects.toThrow(/self/);
    await expect(insertAnswer(me, 'cond', [{ people: [mate], need: 2, minTotal: 0 }])).rejects.toThrow(/need out of range/);
    await expect(insertAnswer(me, 'cond', [ok, { people: [], need: 0, minTotal: 2 }])).resolves.toBeTruthy();
  });

  it('migration 003 converts old single-condition answers into one pattern', async () => {
    const db2 = new PGlite();
    const pool2 = pglitePool(db2);
    const c = await pool2.connect();
    try {
      // Apply only 001/002, insert an old-style answer, then run 003.
      const { readFile } = await import('node:fs/promises');
      const dir = new URL('../../src/infrastructure/persistence/postgres/migrations/', import.meta.url);
      await c.exec(await readFile(new URL('001_init.sql', dir), 'utf8'));
      await c.exec(await readFile(new URL('002_rate_limits.sql', dir), 'utf8'));
      await c.query(
        `insert into rooms (id, title, status, admin_token_hash, created_at, purge_after) values ('old', 't', 'open', 'h', now(), now())`,
      );
      const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
      for (const [i, id] of ids.entries()) {
        await c.query(
          `insert into members (id, room_id, display_name, invite_token_hash, sort_order, created_at) values ($1, 'old', $2, $3, $4, now())`,
          [id, `m${i}`, `h${i}`, i],
        );
      }
      await c.query(
        `insert into answers (member_id, choice, cond_people, cond_need, cond_min_total, updated_at) values ($1, 'cond', $2::uuid[], 1, 2, now())`,
        [ids[0], [ids[1]]],
      );
      await c.query(`insert into answers (member_id, choice, updated_at) values ($1, 'yes', now())`, [ids[1]]);
      await c.exec(await readFile(new URL('003_cond_patterns.sql', dir), 'utf8'));
      const { rows } = await c.query<{ member_id: string; cond_patterns: unknown }>(
        'select member_id, cond_patterns from answers order by member_id',
      );
      expect(rows).toEqual([
        { member_id: ids[0], cond_patterns: [{ people: [ids[1]], need: 1, minTotal: 2 }] },
        { member_id: ids[1], cond_patterns: [] },
      ]);
    } finally {
      c.release();
      await pool2.end();
    }
  });

  it('enables RLS on every table', async () => {
    await ready;
    const { rows } = await exec(
      `select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and not relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });
});
