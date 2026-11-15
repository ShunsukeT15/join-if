import { describe, expect, it } from 'vitest';

process.env.DATA_STORE = 'memory';
process.env.RATE_LIMIT = 'memory';
process.env.ORIGIN_VERIFY_SECRET = 'cf-secret';
process.env.CORS_ORIGINS = '';
const { handler, viewerIp } = await import('../../src/lambda.js');

const urlEvent = (method: string, path: string, headers: Record<string, string>, body?: unknown) => ({
  version: '2.0',
  routeKey: '$default',
  rawPath: path,
  rawQueryString: '',
  headers: { host: 'abc.lambda-url.ap-northeast-1.on.aws', ...headers },
  requestContext: {
    accountId: 'anonymous',
    apiId: 'abc',
    domainName: 'abc.lambda-url.ap-northeast-1.on.aws',
    domainPrefix: 'abc',
    http: { method, path, protocol: 'HTTP/1.1', sourceIp: '130.176.0.1', userAgent: 'Amazon CloudFront' },
    requestId: 'id',
    routeKey: '$default',
    stage: '$default',
    time: '15/Nov/2026:00:00:00 +0000',
    timeEpoch: 0,
  },
  body: body === undefined ? undefined : JSON.stringify(body),
  isBase64Encoded: false,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (e: unknown) => handler(e, {} as any) as Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;

describe('lambda handler', () => {
  it('rejects requests that did not come through CloudFront', async () => {
    const res = await call(urlEvent('POST', '/api/rooms', { 'content-type': 'application/json' }, { title: 't' }));
    expect(res.statusCode).toBe(404);
  });

  it('serves the API with the origin header', async () => {
    const res = await call(
      urlEvent('POST', '/api/rooms', { 'content-type': 'application/json', 'x-origin-verify': 'cf-secret', 'cloudfront-viewer-address': '203.0.113.5:4711' }, { title: 't' }),
    );
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).roomId).toBeTruthy();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('runs maintenance events', async () => {
    expect(await handler({ action: 'migrate' }, {} as never)).toEqual({ applied: [] });
    expect(await handler({ action: 'purge' }, {} as never)).toEqual({ rooms: 0, rateLimits: 0 });
  });

  it('parses CloudFront-Viewer-Address', () => {
    expect(viewerIp('203.0.113.5:4711')).toBe('203.0.113.5');
    expect(viewerIp('2001:db8::1:4711')).toBe('2001:db8::1');
    expect(viewerIp(undefined)).toBeUndefined();
  });
});
