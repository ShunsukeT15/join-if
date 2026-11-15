import { HEADERS, type ErrorCode, type ErrorResponse } from '@himitsu/contracts';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Credential } from '../../application/authorize.js';
import type { Deps } from '../../application/deps.js';
import type { RateLimiter } from '../../application/ports/services.js';
import { AppError, notFound, rateLimited, validation } from '../../domain/errors.js';
import { routes as defaultRoutes, type RouteDef } from './routes.js';
import { emptySchema, ROOM_ID_PATTERN, UUID_PATTERN } from './schemas.js';
import type { z } from 'zod';

export interface AppOptions {
  deps: Deps;
  rateLimiter: RateLimiter;
  /** Returns the client address used for rate limiting. */
  clientIp: (c: Context) => string;
  /** Allowed browser origins for CORS. Empty = same-origin only. */
  corsOrigins: string[];
  routes?: RouteDef[];
  /** Receives unexpected errors. Must not log tokens or answers. */
  onError?: (err: unknown, route: string) => void;
}

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  invite_used: 410,
  closed: 409,
  conflict: 409,
  validation: 422,
  rate_limited: 429,
  internal: 500,
};

const HEADER_FOR = { admin: HEADERS.admin, invite: HEADERS.invite, member: HEADERS.member } as const;

function errorBody(err: AppError): ErrorResponse {
  return { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } };
}

function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const k of issue.keys) fields[k] = '定義されていない項目です';
      continue;
    }
    const key = issue.path.length ? String(issue.path[0]) : '_';
    fields[key] ??= '値が正しくありません';
  }
  return fields;
}

async function readBody(c: Context, schema: z.ZodType | undefined): Promise<unknown> {
  const raw = await c.req.text();
  const effective = schema ?? emptySchema;
  if (!raw.trim()) {
    if (!schema) return {};
    throw validation({ _: '本文がありません' });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw validation({ _: 'JSON の形式が正しくありません' });
  }
  const parsed = effective.safeParse(json);
  if (!parsed.success) throw validation(zodFields(parsed.error));
  return parsed.data;
}

export function createApp(opts: AppOptions) {
  const app = new Hono();
  const routeTable = opts.routes ?? defaultRoutes;

  app.use('*', async (c, next) => {
    await next();
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'no-store');
  });

  app.use(
    '/api/*',
    cors({
      origin: (origin) => (opts.corsOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['Content-Type', HEADERS.admin, HEADERS.invite, HEADERS.member],
      maxAge: 600,
    }),
  );

  app.get('/healthz', (c) => c.json({ ok: true }));

  for (const route of routeTable) {
    app.on(route.method, route.path, async (c) => {
      try {
        const roomId = c.req.param('roomId') ?? '';
        const memberId = c.req.param('memberId') ?? '';
        if (route.path.includes(':roomId') && !ROOM_ID_PATTERN.test(roomId)) throw notFound();
        if (route.path.includes(':memberId') && !UUID_PATTERN.test(memberId)) throw notFound();

        const cred: Credential = route.auth
          ? { kind: route.auth, token: c.req.header(HEADER_FOR[route.auth]) || undefined }
          : { kind: 'admin', token: undefined };

        const ip = opts.clientIp(c);
        for (const rule of route.rate) {
          const subject = rule.by === 'ip' ? ip : opts.deps.tokens.hash(cred.token ?? `ip:${ip}`);
          const ok = await opts.rateLimiter.hit(`${rule.name}:${subject}`, rule.limit, rule.windowMs);
          if (!ok) throw rateLimited();
        }

        const body = await readBody(c, route.body);
        const result = await route.handler({ deps: opts.deps, params: { roomId, memberId }, cred, body });
        if (route.status === 204) return c.body(null, 204);
        return c.json(result as object, route.status);
      } catch (err) {
        if (err instanceof AppError) return c.json(errorBody(err), STATUS[err.code]);
        opts.onError?.(err, `${route.method} ${route.path}`);
        return c.json(
          { error: { code: 'internal', message: 'サーバーでエラーが発生しました' } } satisfies ErrorResponse,
          500,
        );
      }
    });
  }

  app.notFound((c) => c.json(errorBody(notFound()), 404));
  return app;
}
