import type { Deps } from './application/deps.js';
import type { UnitOfWork } from './application/ports/persistence.js';
import type { RateLimiter } from './application/ports/services.js';
import { purgeExpiredRooms } from './application/usecases/admin.js';
import { DEFAULT_RETENTION, type RetentionPolicy } from './domain/constants.js';
import { closeDueRooms } from './application/usecases/closing.js';
import { generateEncryptionKey, NodeIdGenerator, NodeTokenService } from './infrastructure/crypto/nodeTokenService.js';
import { MemoryUnitOfWork } from './infrastructure/persistence/memory/memoryUnitOfWork.js';
import type { SqlPool } from './infrastructure/persistence/postgres/pgClient.js';
import { MemoryRateLimiter, NoopRateLimiter } from './infrastructure/rateLimit/memoryRateLimiter.js';
import { SystemClock } from './infrastructure/systemClock.js';

export interface Config {
  port: number;
  dataStore: 'memory' | 'postgres';
  databaseUrl: string | undefined;
  dbSsl: 'off' | 'require' | 'verify' | undefined;
  dbPoolMax: number;
  tokenEncKey: string;
  corsOrigins: string[];
  trustProxy: boolean;
  rateLimit: 'off' | 'memory' | 'postgres';
  purgeIntervalMs: number;
  originVerify: { header: string; value: string } | undefined;
  retention: RetentionPolicy;
}

function days(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 3650) throw new Error(`${name} must be an integer between 1 and 3650`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataStore = env.DATA_STORE === 'postgres' ? 'postgres' : 'memory';
  let tokenEncKey = env.TOKEN_ENC_KEY?.trim();
  if (!tokenEncKey) {
    if (dataStore === 'postgres') {
      // Stored invite tokens are encrypted with this key; a random key would make them unreadable after a restart.
      throw new Error('TOKEN_ENC_KEY is required with DATA_STORE=postgres. Generate one with: npm run gen-key -w @himitsu/api');
    }
    // In-memory data is lost on restart anyway, so an ephemeral key is fine for local development.
    tokenEncKey = generateEncryptionKey();
    console.warn('[config] TOKEN_ENC_KEY is not set; using a temporary key (memory store only).');
  }
  if (dataStore === 'postgres' && !env.DATABASE_URL) throw new Error('DATABASE_URL is required when DATA_STORE=postgres');

  const rl = env.RATE_LIMIT ?? 'memory';
  const rateLimit = rl === 'off' ? 'off' : rl === 'postgres' ? 'postgres' : 'memory';
  if (rateLimit === 'postgres' && dataStore !== 'postgres') throw new Error('RATE_LIMIT=postgres requires DATA_STORE=postgres');

  const dbSsl = env.DB_SSL === 'off' || env.DB_SSL === 'require' || env.DB_SSL === 'verify' ? env.DB_SSL : undefined;

  return {
    port: Number(env.PORT ?? 8787),
    dataStore,
    databaseUrl: env.DATABASE_URL,
    dbSsl,
    dbPoolMax: Number(env.DB_POOL_MAX ?? 10),
    tokenEncKey,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true',
    rateLimit,
    purgeIntervalMs: Number(env.PURGE_INTERVAL_MS ?? 6 * 60 * 60 * 1000),
    retention: {
      afterCloseDays: days(env.RETENTION_AFTER_CLOSE_DAYS, DEFAULT_RETENTION.afterCloseDays, 'RETENTION_AFTER_CLOSE_DAYS'),
      unclosedDays: days(env.RETENTION_UNCLOSED_DAYS, DEFAULT_RETENTION.unclosedDays, 'RETENTION_UNCLOSED_DAYS'),
    },
    originVerify: env.ORIGIN_VERIFY_SECRET
      ? { header: env.ORIGIN_VERIFY_HEADER ?? 'X-Origin-Verify', value: env.ORIGIN_VERIFY_SECRET }
      : undefined,
  };
}

export interface Container {
  deps: Deps;
  rateLimiter: RateLimiter;
  /** Applies pending DB migrations (no-op for the memory store). */
  migrate: () => Promise<string[]>;
  /** Deletes expired rooms and stale rate-limit counters. */
  purge: () => Promise<{ rooms: number; rateLimits: number }>;
  /** Closes open rooms whose automatic deadline has passed. */
  closeDue: () => Promise<{ closed: number }>;
  close: () => Promise<void>;
}

/** Composition root: the only place that picks concrete adapters. */
export async function buildContainer(config: Config): Promise<Container> {
  let uow: UnitOfWork;
  let pool: SqlPool | undefined;

  if (config.dataStore === 'postgres') {
    const { PostgresUnitOfWork } = await import('./infrastructure/persistence/postgres/postgresUnitOfWork.js');
    const { createPgPool } = await import('./infrastructure/persistence/postgres/pgClient.js');
    pool = createPgPool(config.databaseUrl!, { ssl: config.dbSsl, max: config.dbPoolMax });
    uow = new PostgresUnitOfWork(pool);
  } else {
    uow = new MemoryUnitOfWork();
  }

  let rateLimiter: RateLimiter;
  let sweepRateLimits = async () => 0;
  if (config.rateLimit === 'postgres') {
    const { PostgresRateLimiter } = await import('./infrastructure/rateLimit/postgresRateLimiter.js');
    const pg = new PostgresRateLimiter(pool!);
    rateLimiter = pg;
    sweepRateLimits = () => pg.sweep();
  } else {
    rateLimiter = config.rateLimit === 'memory' ? new MemoryRateLimiter() : new NoopRateLimiter();
  }

  const deps: Deps = {
    uow,
    tokens: new NodeTokenService(config.tokenEncKey),
    ids: new NodeIdGenerator(),
    clock: new SystemClock(),
    retention: config.retention,
  };

  return {
    deps,
    rateLimiter,
    async migrate() {
      if (!pool) return [];
      const { migrate } = await import('./infrastructure/persistence/postgres/migrator.js');
      return migrate(pool, console.log);
    },
    async purge() {
      return { rooms: await purgeExpiredRooms(deps), rateLimits: await sweepRateLimits() };
    },
    async closeDue() {
      return { closed: await closeDueRooms(deps) };
    },
    close: async () => {
      await pool?.end();
    },
  };
}
