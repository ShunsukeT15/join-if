import { HEADERS } from '@himitsu/contracts';
import type { RateLimiter } from '../../src/application/ports/services.js';
import { MemoryUnitOfWork } from '../../src/infrastructure/persistence/memory/memoryUnitOfWork.js';
import { NoopRateLimiter } from '../../src/infrastructure/rateLimit/memoryRateLimiter.js';
import { createApp } from '../../src/presentation/http/app.js';
import { makeDeps } from './deps.js';

export interface Tokens {
  admin?: string;
  invite?: string;
  member?: string;
  group?: string;
}

export function makeHarness(opts: { rateLimiter?: RateLimiter } = {}) {
  const uow = new MemoryUnitOfWork();
  const deps = makeDeps(uow);
  const app = createApp({
    deps,
    rateLimiter: opts.rateLimiter ?? new NoopRateLimiter(),
    clientIp: (c) => c.req.header('x-test-ip') ?? '127.0.0.1',
    corsOrigins: ['https://app.example'],
  });

  async function call(method: string, path: string, init: { tokens?: Tokens; body?: unknown; rawBody?: string; ip?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.tokens?.admin !== undefined) headers[HEADERS.admin] = init.tokens.admin;
    if (init.tokens?.invite !== undefined) headers[HEADERS.invite] = init.tokens.invite;
    if (init.tokens?.member !== undefined) headers[HEADERS.member] = init.tokens.member;
    if (init.tokens?.group !== undefined) headers[HEADERS.group] = init.tokens.group;
    if (init.ip) headers['x-test-ip'] = init.ip;
    let body: string | undefined;
    if (init.rawBody !== undefined) body = init.rawBody;
    else if (init.body !== undefined) body = JSON.stringify(init.body);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await app.request(path, { method, headers, body });
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = text ? JSON.parse(text) : null;
    return { status: res.status, json, headers: res.headers };
  }

  /** Creates a room with named members, all claimed. */
  async function setupRoom(names: string[], title = '結婚式') {
    const created = await call('POST', '/api/rooms', { body: { title, deadlineText: '12月20日', message: 'msg' } });
    const roomId: string = created.json.roomId;
    const adminToken: string = created.json.adminToken;
    const members: Record<string, { id: string; token: string; inviteToken: string }> = {};
    for (const name of names) {
      const added = await call('POST', `/api/rooms/${roomId}/members`, { tokens: { admin: adminToken }, body: { name } });
      const inviteToken: string = added.json.member.inviteToken;
      const claimed = await call('POST', `/api/rooms/${roomId}/claim`, { tokens: { invite: inviteToken } });
      members[name] = { id: added.json.member.id, token: claimed.json.memberToken, inviteToken };
    }
    return { roomId, adminToken, members };
  }

  /** Creates a group-mode room; every name in `names` is picked (claimed) through the group URL. */
  async function setupGroupRoom(names: string[], title = 'グループ', extraUnpicked: string[] = []) {
    const created = await call('POST', '/api/rooms', { body: { title, inviteMode: 'group' } });
    const roomId: string = created.json.roomId;
    const adminToken: string = created.json.adminToken;
    const view = await call('GET', `/api/rooms/${roomId}/admin`, { tokens: { admin: adminToken } });
    const groupToken: string = view.json.groupToken;
    const members: Record<string, { id: string; token: string }> = {};
    const unpicked: Record<string, string> = {};
    for (const name of [...names, ...extraUnpicked]) {
      const added = await call('POST', `/api/rooms/${roomId}/members`, { tokens: { admin: adminToken }, body: { name } });
      const id: string = added.json.member.id;
      if (names.includes(name)) {
        const claimed = await call('POST', `/api/rooms/${roomId}/group/claim`, { tokens: { group: groupToken }, body: { memberId: id } });
        members[name] = { id, token: claimed.json.memberToken };
      } else unpicked[name] = id;
    }
    return { roomId, adminToken, groupToken, members, unpicked };
  }

  return { app, uow, deps, call, setupRoom, setupGroupRoom };
}
