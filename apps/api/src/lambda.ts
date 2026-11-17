/**
 * AWS Lambda entry point.
 * - HTTP requests arrive through a Lambda Function URL behind CloudFront.
 * - Maintenance events ({ action: 'migrate' | 'purge' }) come from the deploy script / EventBridge.
 */
import type { Context as LambdaContext } from 'aws-lambda';
import { handle } from 'hono/aws-lambda';
import * as Ops from './application/usecases/deletion.js';
import { buildContainer, loadConfig, type Container } from './container.js';
import { createApp } from './presentation/http/app.js';

type Action = 'migrate' | 'purge' | 'close-due' | 'stats' | 'delete-test-data' | 'delete-room' | 'delete-event' | 'reset-all';
type Maintenance = { action: Action; roomId?: string; eventId?: string; prefix?: string; confirm?: string };
const ACTIONS: readonly string[] = ['migrate', 'purge', 'close-due', 'stats', 'delete-test-data', 'delete-room', 'delete-event', 'reset-all'];

const config = loadConfig();
const containerPromise: Promise<Container> = buildContainer(config);

/** "203.0.113.5:4711" or "[2001:db8::1]:4711" / "2001:db8::1:4711" → address without port. */
export function viewerIp(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const i = header.lastIndexOf(':');
  const ip = i > 0 ? header.slice(0, i) : header;
  return ip.replace(/^\[|\]$/g, '');
}

let httpHandler: ReturnType<typeof handle> | undefined;
async function getHttpHandler() {
  if (!httpHandler) {
    const container = await containerPromise;
    const app = createApp({
      deps: container.deps,
      rateLimiter: container.rateLimiter,
      corsOrigins: config.corsOrigins,
      originVerify: config.originVerify,
      // CloudFront sets this header itself; viewers cannot spoof it.
      clientIp: (c) => viewerIp(c.req.header('cloudfront-viewer-address')) ?? 'unknown',
      onError: (err, route) =>
        console.error(`[api] ${route} failed:`, err instanceof Error ? `${err.name}: ${err.message}` : 'unknown'),
    });
    httpHandler = handle(app);
  }
  return httpHandler;
}

export const handler = async (event: unknown, context: LambdaContext) => {
  const m = event as Partial<Maintenance> | null;
  const action = m?.action;
  // Maintenance events come only from operators with IAM access (aws lambda invoke) or
  // EventBridge; CloudFront requests are HTTP events and never carry `action`.
  if (action && ACTIONS.includes(action)) {
    const container = await containerPromise;
    const deps = container.deps;
    if (action === 'stats') return Ops.opsStats(deps);
    if (action === 'delete-test-data') return Ops.opsDeleteTestData(deps, m?.prefix ?? Ops.TEST_DATA_PREFIX);
    if (action === 'delete-room') return Ops.opsDeleteRoom(deps, String(m?.roomId ?? ''));
    if (action === 'delete-event') return Ops.opsDeleteEvent(deps, String(m?.eventId ?? ''));
    if (action === 'reset-all') return Ops.opsResetAll(deps, m?.confirm);
    if (action === 'migrate') return { applied: await container.migrate() };
    if (action === 'close-due') {
      const r = await container.closeDue();
      if (r.closed > 0) console.log('[close-due]', JSON.stringify(r));
      return r;
    }
    const result = await container.purge();
    console.log('[purge]', JSON.stringify(result));
    return result;
  }
  const h = await getHttpHandler();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return h(event as any, context as any);
};
