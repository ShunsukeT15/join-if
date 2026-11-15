import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { buildContainer, loadConfig } from './container.js';
import { createApp } from './presentation/http/app.js';

const config = loadConfig();
const container = await buildContainer(config);

const app = createApp({
  deps: container.deps,
  rateLimiter: container.rateLimiter,
  corsOrigins: config.corsOrigins,
  originVerify: config.originVerify,
  clientIp: (c) => {
    if (config.trustProxy) {
      const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (fwd) return fwd;
    }
    return getConnInfo(c).remote.address ?? 'unknown';
  },
  // Only the error type and route; never request headers or bodies (tokens / answers).
  onError: (err, route) => console.error(`[api] ${route} failed:`, err instanceof Error ? err.name + ': ' + err.message : 'unknown'),
});

const purge = async () => {
  try {
    const n = await container.purge();
    if (n.rooms > 0) console.log(`[purge] removed ${n.rooms} expired room(s)`);
  } catch (e) {
    console.error('[purge] failed', e instanceof Error ? e.message : e);
  }
};
void purge();
const timer = setInterval(purge, config.purgeIntervalMs);
timer.unref();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port} (store=${config.dataStore})`);
});

const shutdown = async () => {
  clearInterval(timer);
  server.close();
  await container.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
