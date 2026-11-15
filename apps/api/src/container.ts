import type { Deps } from './application/deps.js';
import type { UnitOfWork } from './application/ports/persistence.js';
import type { RateLimiter } from './application/ports/services.js';
import { NodeIdGenerator, NodeTokenService } from './infrastructure/crypto/nodeTokenService.js';
import { MemoryUnitOfWork } from './infrastructure/persistence/memory/memoryUnitOfWork.js';
import { MemoryRateLimiter, NoopRateLimiter } from './infrastructure/rateLimit/memoryRateLimiter.js';
import { SystemClock } from './infrastructure/systemClock.js';

export interface Config {
  port: number;
  dataStore: 'memory' | 'postgres';
  databaseUrl: string | undefined;
  tokenEncKey: string;
  corsOrigins: string[];
  trustProxy: boolean;
  rateLimit: boolean;
  purgeIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataStore = env.DATA_STORE === 'postgres' ? 'postgres' : 'memory';
  const tokenEncKey = env.TOKEN_ENC_KEY;
  if (!tokenEncKey) {
    throw new Error('TOKEN_ENC_KEY is required (32 random bytes, base64). Generate one with: npm run gen-key -w @himitsu/api');
  }
  if (dataStore === 'postgres' && !env.DATABASE_URL) throw new Error('DATABASE_URL is required when DATA_STORE=postgres');
  return {
    port: Number(env.PORT ?? 8787),
    dataStore,
    databaseUrl: env.DATABASE_URL,
    tokenEncKey,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true',
    rateLimit: env.RATE_LIMIT !== 'off',
    purgeIntervalMs: Number(env.PURGE_INTERVAL_MS ?? 6 * 60 * 60 * 1000),
  };
}

export interface Container {
  deps: Deps;
  rateLimiter: RateLimiter;
  close: () => Promise<void>;
}

/** Composition root: the only place that picks concrete adapters. */
export async function buildContainer(config: Config): Promise<Container> {
  let uow: UnitOfWork;
  let close = async () => {};

  if (config.dataStore === 'postgres') {
    const { PostgresUnitOfWork } = await import('./infrastructure/persistence/postgres/postgresUnitOfWork.js');
    const { createPgPool } = await import('./infrastructure/persistence/postgres/pgClient.js');
    const pool = createPgPool(config.databaseUrl!);
    uow = new PostgresUnitOfWork(pool);
    close = () => pool.end();
  } else {
    uow = new MemoryUnitOfWork();
  }

  return {
    deps: {
      uow,
      tokens: new NodeTokenService(config.tokenEncKey),
      ids: new NodeIdGenerator(),
      clock: new SystemClock(),
    },
    rateLimiter: config.rateLimit ? new MemoryRateLimiter() : new NoopRateLimiter(),
    close,
  };
}
