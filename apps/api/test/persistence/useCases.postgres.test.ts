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

  it('rejects cond answers without any condition', async () => {
    await seedRoom('r2');
    const { rows } = await addMember('r2', 1);
    const id = (rows[0] as { id: string }).id;
    await expect(
      exec(`insert into answers (member_id, choice, updated_at) values ($1, 'cond', now())`, [id]),
    ).rejects.toThrow();
  });

  it('rejects cond_people from another room or self', async () => {
    await seedRoom('r3');
    await exec(
      `insert into rooms (id, title, status, admin_token_hash, created_at, purge_after) values ('r4', 't', 'open', 'h-r4', now(), now())`,
    );
    const me = ((await addMember('r3', 1)).rows[0] as { id: string }).id;
    const other = ((await addMember('r4', 1)).rows[0] as { id: string }).id;
    await expect(
      exec(
        `insert into answers (member_id, choice, cond_people, cond_need, updated_at) values ($1, 'cond', $2::uuid[], 1, now())`,
        [me, [other]],
      ),
    ).rejects.toThrow(/same room/);
    await expect(
      exec(
        `insert into answers (member_id, choice, cond_people, cond_need, updated_at) values ($1, 'cond', $2::uuid[], 1, now())`,
        [me, [me]],
      ),
    ).rejects.toThrow(/self/);
  });

  it('enables RLS on every table', async () => {
    await ready;
    const { rows } = await exec(
      `select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and not relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });
});
