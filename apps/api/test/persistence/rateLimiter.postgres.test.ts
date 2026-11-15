import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/infrastructure/persistence/postgres/migrator.js';
import { PostgresRateLimiter } from '../../src/infrastructure/rateLimit/postgresRateLimiter.js';
import { pglitePool } from '../support/pglite.js';

const pool = pglitePool(new PGlite());
const ready = migrate(pool);
afterAll(() => pool.end());

describe('PostgresRateLimiter', () => {
  it('counts within a window and resets after it', async () => {
    await ready;
    let t = new Date('2026-11-15T00:00:00Z').getTime();
    const rl = new PostgresRateLimiter(pool, () => new Date(t));
    for (let i = 0; i < 3; i++) expect(await rl.hit('k', 3, 60_000)).toBe(true);
    expect(await rl.hit('k', 3, 60_000)).toBe(false);
    expect(await rl.hit('other', 3, 60_000)).toBe(true);
    t += 60_000;
    expect(await rl.hit('k', 3, 60_000)).toBe(true);
    t += 3 * 60 * 60 * 1000;
    expect(await rl.sweep()).toBe(2);
  });

  it('stores only hashed keys', async () => {
    await ready;
    const rl = new PostgresRateLimiter(pool);
    await rl.hit('ip:203.0.113.5', 10, 60_000);
    const conn = await pool.connect();
    const { rows } = await conn.query<{ key: string }>('select key from rate_limits');
    conn.release();
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.key))).toBe(true);
  });
});
