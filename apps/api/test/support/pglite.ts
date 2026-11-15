import { PGlite } from '@electric-sql/pglite';
import type { SqlPool } from '../../src/infrastructure/persistence/postgres/pgClient.js';

/**
 * SqlPool over an in-process PGlite instance. PGlite has a single session,
 * so connections are handed out one at a time (like a pool of size 1).
 */
export function pglitePool(db: PGlite): SqlPool {
  let queue: Promise<void> = Promise.resolve();
  return {
    async connect() {
      let release!: () => void;
      const next = new Promise<void>((r) => (release = r));
      const prev = queue;
      queue = prev.then(() => next);
      await prev;
      let released = false;
      return {
        async query(text, params) {
          const r = await db.query(text, params as unknown[] | undefined);
          return { rows: r.rows as never[], rowCount: r.affectedRows ?? r.rows.length };
        },
        async exec(sql) {
          await db.exec(sql);
        },
        release() {
          if (!released) {
            released = true;
            release();
          }
        },
      };
    },
    async end() {
      await db.close();
    },
  };
}
