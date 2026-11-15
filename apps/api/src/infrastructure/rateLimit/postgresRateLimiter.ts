import { createHash } from 'node:crypto';
import type { RateLimiter } from '../../application/ports/services.js';
import type { SqlPool } from '../persistence/postgres/pgClient.js';

/**
 * Fixed-window counter stored in Postgres, shared by every API instance.
 * Keys are hashed so neither IP addresses nor tokens are stored.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly pool: SqlPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const hashed = createHash('sha256').update(key).digest('hex');
    const now = this.now();
    const conn = await this.pool.connect();
    try {
      const { rows } = await conn.query<{ count: number }>(
        `insert into rate_limits (key, window_start, count) values ($1, $2, 1)
         on conflict (key) do update set
           count = case when rate_limits.window_start <= $3 then 1 else rate_limits.count + 1 end,
           window_start = case when rate_limits.window_start <= $3 then $2 else rate_limits.window_start end
         returning count`,
        [hashed, now, new Date(now.getTime() - windowMs)],
      );
      return (rows[0]?.count ?? 1) <= limit;
    } finally {
      conn.release();
    }
  }

  /** Removes counters whose window ended long ago. */
  async sweep(olderThanMs = 2 * 60 * 60 * 1000): Promise<number> {
    const conn = await this.pool.connect();
    try {
      const { rowCount } = await conn.query('delete from rate_limits where window_start < $1', [
        new Date(this.now().getTime() - olderThanMs),
      ]);
      return rowCount;
    } finally {
      conn.release();
    }
  }
}
