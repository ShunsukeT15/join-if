import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRateLimiter } from '../../src/infrastructure/rateLimit/memoryRateLimiter.js';
import { routes } from '../../src/presentation/http/routes.js';
import { makeHarness } from '../support/http.js';

/** Keys that describe an individual's answer or activity. Only the owner may see them. */
const PRIVATE_KEYS = ['choice', 'patterns', 'people', 'need', 'minTotal', 'updatedAt', 'saveCount', 'claimedAt', 'conditionNotice', 'answer', 'me', 'memberToken'];

function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

describe('secrecy: no one sees another person\'s answer', () => {
  it('admin responses contain no answer data', async () => {
    const h = makeHarness();
    const { roomId, adminToken, members } = await h.setupRoom(['A', 'B', 'C']);
    await h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: members.A!.token }, body: { choice: 'yes' } });
    await h.call('PUT', `/api/rooms/${roomId}/me/answer`, {
      tokens: { member: members.B!.token },
      body: {
        choice: 'cond',
        patterns: [
          { people: [members.A!.id], need: 1, minTotal: 1 },
          { people: [members.C!.id], need: 1, minTotal: 0 },
        ],
      },
    });

    const responses = [
      await h.call('GET', `/api/rooms/${roomId}/admin`, { tokens: { admin: adminToken } }),
      await h.call('PATCH', `/api/rooms/${roomId}/admin`, { tokens: { admin: adminToken }, body: { message: 'x' } }),
      await h.call('POST', `/api/rooms/${roomId}/members/${members.C!.id}/reissue`, { tokens: { admin: adminToken } }),
      await h.call('POST', `/api/rooms/${roomId}/close`, { tokens: { admin: adminToken } }),
      await h.call('POST', `/api/rooms/${roomId}/reopen`, { tokens: { admin: adminToken } }),
    ];
    for (const r of responses) {
      expect(r.status).toBe(200);
      const keys = collectKeys(r.json);
      for (const k of PRIVATE_KEYS) expect(keys.has(k), `admin response leaked "${k}"`).toBe(false);
    }
  });

  it('a member sees only their own answer', async () => {
    const h = makeHarness();
    const { roomId, members } = await h.setupRoom(['A', 'B']);
    await h.call('PUT', `/api/rooms/${roomId}/me/answer`, {
      tokens: { member: members.A!.token },
      body: { choice: 'cond', patterns: [{ people: [members.B!.id], need: 1, minTotal: 0 }] },
    });
    const b = await h.call('GET', `/api/rooms/${roomId}/me`, { tokens: { member: members.B!.token } });
    expect(b.status).toBe(200);
    expect(b.json.me.id).toBe(members.B!.id);
    expect(b.json.me.answer).toBeNull();
    const { me: _me, ...rest } = b.json;
    const keys = collectKeys(rest);
    for (const k of PRIVATE_KEYS) expect(keys.has(k), `member view leaked "${k}"`).toBe(false);
    for (const m of b.json.members) expect(Object.keys(m).sort()).toEqual(['answered', 'id', 'name']);
  });

  it('"no" and "condition not met" produce identical responses', async () => {
    const snapshot = async (variant: 'no' | 'unmet') => {
      const h = makeHarness();
      const { roomId, adminToken, members } = await h.setupRoom(['A', 'X', 'Y']);
      await h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: members.A!.token }, body: { choice: 'yes' } });
      await h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: members.Y!.token }, body: { choice: 'no' } });
      await h.call('PUT', `/api/rooms/${roomId}/me/answer`, {
        tokens: { member: members.X!.token },
        body: variant === 'no' ? { choice: 'no' } : { choice: 'cond', patterns: [{ people: [members.Y!.id], need: 1, minTotal: 0 }] },
      });
      const closed = await h.call('POST', `/api/rooms/${roomId}/close`, { tokens: { admin: adminToken } });
      const adminView = await h.call('GET', `/api/rooms/${roomId}/admin`, { tokens: { admin: adminToken } });
      const otherView = await h.call('GET', `/api/rooms/${roomId}/me`, { tokens: { member: members.A!.token } });
      const replaceIds = (v: unknown) => {
        let s = JSON.stringify(v);
        for (const [name, m] of Object.entries(members)) s = s.replaceAll(m.id, `<${name}>`);
        return JSON.parse(s.replace(/"\d{4}-\d{2}-\d{2}T[^"]+"/g, '"<time>"'));
      };
      return replaceIds({ closed: closed.json, adminView: adminView.json, otherView: otherView.json });
    };
    const no = await snapshot('no');
    const unmet = await snapshot('unmet');
    expect(unmet).toEqual(no);
    expect(no.closed.result.attending).toEqual(['<A>']);
  });
});

// ---- Authorization matrix over every route ----

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

/** Two individual-mode rooms and two group-mode rooms in one store. */
async function makeFixture() {
  const h = makeHarness();
  const room = await h.setupRoom(['A', 'B']);
  const other = await h.setupRoom(['Z'], 'other');
  // An unused invite in each individual room.
  const pending = await h.call('POST', `/api/rooms/${room.roomId}/members`, { tokens: { admin: room.adminToken }, body: { name: 'P' } });
  const otherPending = await h.call('POST', `/api/rooms/${other.roomId}/members`, { tokens: { admin: other.adminToken }, body: { name: 'Q' } });
  const groupRoom = await h.setupGroupRoom(['A', 'B'], 'g', ['P']);
  const groupOther = await h.setupGroupRoom(['Z'], 'g-other', ['Q']);
  const event = await h.setupEvent(['A', 'B'], 'e');
  const eventOther = await h.setupEvent(['Z'], 'e-other');
  return {
    h,
    event: { room: event, other: eventOther },
    indiv: { room, other, pendingInvite: pending.json.member.inviteToken as string, otherPendingInvite: otherPending.json.member.inviteToken as string },
    group: { room: groupRoom, other: groupOther },
  };
}

type Kind = 'admin' | 'invite' | 'member' | 'group';

/** The rooms a route is exercised against: group routes need group-mode rooms. */
function ctxFor(f: Fixture, path: string) {
  const isGroup = path.includes('/group');
  const isEvent = path.startsWith('/api/events/');
  const room = isEvent ? f.event.room : isGroup ? f.group.room : f.indiv.room;
  const other = isEvent ? f.event.other : isGroup ? f.group.other : f.indiv.other;
  const tokenOf = (kind: Kind, which: 'room' | 'other'): string => {
    const r = which === 'room' ? room : other;
    if (kind === 'admin') return r.adminToken;
    if (kind === 'member') return which === 'room' ? r.members.A!.token : r.members.Z!.token;
    if (kind === 'group') return which === 'room' ? f.group.room.groupToken : f.group.other.groupToken;
    return which === 'room' ? f.indiv.pendingInvite : f.indiv.otherPendingInvite;
  };
  const unpicked = (which: 'room' | 'other') => (which === 'room' ? f.group.room.unpicked.P! : f.group.other.unpicked.Q!);
  return { room, other, tokenOf, unpicked };
}
type Ctx = ReturnType<typeof ctxFor>;

/** A valid body per route. A new route without an entry fails the test below. */
const SAMPLE_BODIES: Record<string, (c: Ctx) => unknown> = {
  'POST /api/rooms': () => ({ title: 't' }),
  'GET /api/rooms/:roomId/admin': () => undefined,
  'PATCH /api/rooms/:roomId/admin': () => ({ title: 'changed' }),
  'POST /api/rooms/:roomId/members': () => ({ name: 'new' }),
  'DELETE /api/rooms/:roomId/members/:memberId': () => undefined,
  'POST /api/rooms/:roomId/members/:memberId/reissue': () => undefined,
  'POST /api/rooms/:roomId/close': () => undefined,
  'POST /api/rooms/:roomId/reopen': () => undefined,
  'POST /api/rooms/:roomId/claim': () => undefined,
  'GET /api/rooms/:roomId/me': () => undefined,
  'PUT /api/rooms/:roomId/me/answer': () => ({ choice: 'yes' }),
  'POST /api/rooms/:roomId/group/reissue': () => undefined,
  'GET /api/rooms/:roomId/group': () => undefined,
  'POST /api/rooms/:roomId/group/claim': (c) => ({ memberId: c.unpicked('room') }),
  'POST /api/events': () => ({ title: 'e' }),
  'GET /api/events/:eventId/admin': () => undefined,
  'PATCH /api/events/:eventId/admin': () => ({ title: 'changed' }),
  'POST /api/events/:eventId/communities': () => ({ name: 'new community' }),
};

describe('authorization: every protected route rejects bad credentials without side effects', () => {
  it('every route has a sample body', () => {
    for (const r of routes) expect(SAMPLE_BODIES[`${r.method} ${r.path}`], `${r.method} ${r.path}`).toBeDefined();
  });

  const protectedRoutes = routes.filter((r) => r.auth !== null);
  const kinds: Kind[] = ['admin', 'invite', 'member', 'group'];

  for (const route of protectedRoutes) {
    const key = `${route.method} ${route.path}`;
    describe(key, () => {
      let f: Fixture;
      let c: Ctx;
      beforeEach(async () => {
        f = await makeFixture();
        c = ctxFor(f, route.path);
      });

      const path = (roomId: string, memberId: string) =>
        route.path.replace(':roomId', roomId).replace(':eventId', roomId).replace(':memberId', memberId);

      const expectRejected = async (init: { tokens: Record<string, string>; roomId?: string; memberId?: string; body?: unknown }) => {
        const before = f.h.uow.dump();
        const res = await f.h.call(route.method, path(init.roomId ?? c.room.roomId, init.memberId ?? c.room.members.B!.id), {
          tokens: init.tokens,
          body: init.body ?? SAMPLE_BODIES[key]!(c),
        });
        expect(res.status).toBe(404);
        expect(f.h.uow.dump()).toEqual(before);
      };

      it('no token', async () => {
        await expectRejected({ tokens: {} });
      });

      for (const kind of kinds.filter((k) => k !== route.auth)) {
        it(`${kind} token instead of ${route.auth}`, async () => {
          // Both in its own header and in the header the route expects.
          await expectRejected({ tokens: { [kind]: c.tokenOf(kind, 'room') } });
          await expectRejected({ tokens: { [route.auth!]: c.tokenOf(kind, 'room') } });
        });
      }

      it('token of another room', async () => {
        await expectRejected({ tokens: { [route.auth!]: c.tokenOf(route.auth!, 'other') } });
      });

      it('valid token, path points at another room', async () => {
        await expectRejected({ tokens: { [route.auth!]: c.tokenOf(route.auth!, 'room') }, roomId: c.other.roomId });
      });

      if (route.path.includes(':memberId')) {
        it('memberId of another room', async () => {
          await expectRejected({ tokens: { admin: c.room.adminToken }, memberId: c.other.members.Z!.id });
        });
        it('malformed memberId', async () => {
          await expectRejected({ tokens: { admin: c.room.adminToken }, memberId: 'not-a-uuid' });
        });
      }

      if (key === 'POST /api/rooms/:roomId/group/claim') {
        it('memberId (in the body) of another room', async () => {
          await expectRejected({ tokens: { group: c.tokenOf('group', 'room') }, body: { memberId: c.unpicked('other') } });
        });
      }

      it('succeeds with the right token (sanity)', async () => {
        if (route.path.endsWith('/reopen')) {
          await f.h.call('POST', `/api/rooms/${c.room.roomId}/close`, { tokens: { admin: c.room.adminToken } });
        }
        const res = await f.h.call(route.method, path(c.room.roomId, c.room.members.B!.id), {
          tokens: { [route.auth!]: c.tokenOf(route.auth!, 'room') },
          body: SAMPLE_BODIES[key]!(c),
        });
        expect(res.status).toBe(route.status);
      });
    });
  }

  it('event tokens reach only their own event and its communities', async () => {
    const f = await makeFixture();
    const ev = f.event.room;
    const other = f.event.other;
    // The event token manages its own communities…
    expect((await f.h.call('GET', `/api/rooms/${ev.communityRoomId}/admin`, { tokens: { admin: ev.adminToken } })).status).toBe(200);
    // …but not another event's communities, nor standalone rooms.
    expect((await f.h.call('GET', `/api/rooms/${other.communityRoomId}/admin`, { tokens: { admin: ev.adminToken } })).status).toBe(404);
    expect((await f.h.call('GET', `/api/rooms/${f.indiv.room.roomId}/admin`, { tokens: { admin: ev.adminToken } })).status).toBe(404);
    // A standalone room's admin token cannot open an event.
    expect((await f.h.call('GET', `/api/events/${ev.eventId}/admin`, { tokens: { admin: f.indiv.room.adminToken } })).status).toBe(404);
    // Members never see event-level data.
    const me = await f.h.call('GET', `/api/rooms/${ev.communityRoomId}/me`, { tokens: { member: ev.members.A!.token } });
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.json)).not.toMatch(/"event"|communities|attendees|totals/);
    expect(me.json.room.communityName).toBe('コミュニティ1');
  });

  it('group routes reject individual-mode rooms, and individual claim rejects group rooms', async () => {
    const f = await makeFixture();
    const indivAdmin = { admin: f.indiv.room.adminToken };
    expect((await f.h.call('POST', `/api/rooms/${f.indiv.room.roomId}/group/reissue`, { tokens: indivAdmin })).status).toBe(404);
    expect((await f.h.call('GET', `/api/rooms/${f.indiv.room.roomId}/group`, { tokens: { group: f.group.room.groupToken } })).status).toBe(404);
  });
});

describe('tampering: server-owned fields are rejected', () => {
  it.each([
    ['PUT', 'me/answer', 'member', { choice: 'yes', memberId: 'x' }],
    ['PUT', 'me/answer', 'member', { choice: 'yes', updatedAt: '2000-01-01T00:00:00Z' }],
    ['POST', 'close', 'admin', { attending: [] }],
    ['POST', 'reopen', 'admin', { status: 'open' }],
    ['PATCH', 'admin', 'admin', { status: 'closed' }],
    ['PATCH', 'admin', 'admin', { title: 'x', purgeAfter: '2100-01-01' }],
    ['POST', 'members', 'admin', { name: 'x', inviteUsedAt: null }],
    ['POST', 'claim', 'invite', { memberToken: 'mine' }],
  ] as const)('%s %s with %j → 422, unchanged', async (method, suffix, kind, body) => {
    const h = makeHarness();
    const { roomId, adminToken, members } = await h.setupRoom(['A']);
    const p = await h.call('POST', `/api/rooms/${roomId}/members`, { tokens: { admin: adminToken }, body: { name: 'P' } });
    const token = kind === 'admin' ? adminToken : kind === 'member' ? members.A!.token : p.json.member.inviteToken;
    const before = h.uow.dump();
    const res = await h.call(method, `/api/rooms/${roomId}/${suffix}`, { tokens: { [kind]: token }, body });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('validation');
    expect(h.uow.dump()).toEqual(before);
  });

  it('room creation rejects unknown fields', async () => {
    const h = makeHarness();
    const res = await h.call('POST', '/api/rooms', { body: { title: 't', status: 'closed' } });
    expect(res.status).toBe(422);
    expect(res.json.error.fields.status).toBeDefined();
  });

  it('invalid JSON → 422', async () => {
    const h = makeHarness();
    const res = await h.call('POST', '/api/rooms', { rawBody: '{nope' });
    expect(res.status).toBe(422);
  });
});

describe('invite URLs', () => {
  it('second claim → 410', async () => {
    const h = makeHarness();
    const { roomId, members } = await h.setupRoom(['A']);
    const res = await h.call('POST', `/api/rooms/${roomId}/claim`, { tokens: { invite: members.A!.inviteToken } });
    expect(res.status).toBe(410);
    expect(res.json.error.code).toBe('invite_used');
  });

  it('concurrent claims → exactly one success', async () => {
    const h = makeHarness();
    const { roomId, adminToken } = await h.setupRoom([]);
    const added = await h.call('POST', `/api/rooms/${roomId}/members`, { tokens: { admin: adminToken }, body: { name: 'A' } });
    const statuses = await Promise.all(
      Array.from({ length: 8 }, () =>
        h.call('POST', `/api/rooms/${roomId}/claim`, { tokens: { invite: added.json.member.inviteToken } }).then((r) => r.status),
      ),
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 410)).toHaveLength(7);
  });

  it('reissue → old member URL 404 and answer gone', async () => {
    const h = makeHarness();
    const { roomId, adminToken, members } = await h.setupRoom(['A']);
    await h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: members.A!.token }, body: { choice: 'yes' } });
    const re = await h.call('POST', `/api/rooms/${roomId}/members/${members.A!.id}/reissue`, { tokens: { admin: adminToken } });
    expect(re.status).toBe(200);
    expect((await h.call('GET', `/api/rooms/${roomId}/me`, { tokens: { member: members.A!.token } })).status).toBe(404);
    expect((await h.call('POST', `/api/rooms/${roomId}/claim`, { tokens: { invite: members.A!.inviteToken } })).status).toBe(404);
    const view = await h.call('GET', `/api/rooms/${roomId}/admin`, { tokens: { admin: adminToken } });
    expect(view.json.members[0]).toMatchObject({ answered: false, inviteUsed: false, inviteToken: re.json.member.inviteToken });
  });

  it('closed room: save → 409, reissue → 409', async () => {
    const h = makeHarness();
    const { roomId, adminToken, members } = await h.setupRoom(['A']);
    await h.call('POST', `/api/rooms/${roomId}/close`, { tokens: { admin: adminToken } });
    const save = await h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: members.A!.token }, body: { choice: 'yes' } });
    expect(save.status).toBe(409);
    const re = await h.call('POST', `/api/rooms/${roomId}/members/${members.A!.id}/reissue`, { tokens: { admin: adminToken } });
    expect(re.status).toBe(409);
  });

  it('close and save racing over HTTP stay consistent', async () => {
    const h = makeHarness();
    const { roomId, adminToken, members } = await h.setupRoom(['A']);
    const [close, save] = await Promise.all([
      h.call('POST', `/api/rooms/${roomId}/close`, { tokens: { admin: adminToken } }),
      h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: members.A!.token }, body: { choice: 'yes' } }),
    ]);
    expect(close.status).toBe(200);
    const view = await h.call('GET', `/api/rooms/${roomId}/admin`, { tokens: { admin: adminToken } });
    expect(view.json.result.attending).toEqual(save.status === 200 ? [members.A!.id] : []);
    if (save.status !== 200) expect(save.status).toBe(409);
  });
});

describe('validation errors', () => {
  it('member limit → 422 with message', async () => {
    const h = makeHarness();
    const { roomId, adminToken } = await h.setupRoom([]);
    for (let i = 0; i < 100; i++) {
      await h.call('POST', `/api/rooms/${roomId}/members`, { tokens: { admin: adminToken }, body: { name: `m${i}` } });
    }
    const res = await h.call('POST', `/api/rooms/${roomId}/members`, { tokens: { admin: adminToken }, body: { name: 'x' } });
    expect(res.status).toBe(422);
    expect(res.json.error.message).toBe('メンバーは100人までです');
  });

  it('too long / duplicate names → 422 with field', async () => {
    const h = makeHarness();
    const { roomId, adminToken } = await h.setupRoom(['A']);
    const dup = await h.call('POST', `/api/rooms/${roomId}/members`, { tokens: { admin: adminToken }, body: { name: 'A' } });
    expect(dup.status).toBe(422);
    expect(dup.json.error.fields.name).toBeDefined();
    const long = await h.call('POST', `/api/rooms/${roomId}/members`, { tokens: { admin: adminToken }, body: { name: 'あ'.repeat(51) } });
    expect(long.status).toBe(422);
  });

  it('invalid conditions → 422 per field', async () => {
    const h = makeHarness();
    const { roomId, members, other } = await (async () => {
      const r = await h.setupRoom(['A', 'B']);
      const o = await h.setupRoom(['Z'], 'o');
      return { ...r, other: o };
    })();
    const save = (body: unknown) => h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: members.A!.token }, body });
    const pt = (people: string[], need: number, minTotal = 0) => ({ people, need, minTotal });
    expect((await save({ choice: 'cond', patterns: [pt([members.A!.id], 1)] })).json.error.fields['patterns.0.people']).toBeDefined();
    expect(
      (await save({ choice: 'cond', patterns: [pt([members.B!.id], 1), pt([other.members.Z!.id], 1)] })).json.error.fields['patterns.1.people'],
    ).toBeDefined();
    expect((await save({ choice: 'cond', patterns: [pt([members.B!.id], 2)] })).json.error.fields['patterns.0.need']).toBeDefined();
    expect((await save({ choice: 'cond', patterns: Array.from({ length: 6 }, () => pt([members.B!.id], 1)) })).status).toBe(422);
    // Old (pre-OR) request shape is rejected as unknown fields.
    expect((await save({ choice: 'cond', condPeople: [members.B!.id], condNeed: 1 })).status).toBe(422);
    // Unknown keys inside a pattern are rejected too.
    expect((await save({ choice: 'cond', patterns: [{ ...pt([members.B!.id], 1), memberId: 'x' }] })).status).toBe(422);
    expect((await save({ choice: 'cond' })).status).toBe(422);
    expect((await save({ choice: 'maybe' })).status).toBe(422);
  });
});

describe('rate limits (spec §8.5)', () => {
  it('room creation: 10 per hour per address', async () => {
    const h = makeHarness({ rateLimiter: new MemoryRateLimiter() });
    for (let i = 0; i < 10; i++) expect((await h.call('POST', '/api/rooms', { body: { title: 't' }, ip: '1.1.1.1' })).status).toBe(201);
    expect((await h.call('POST', '/api/rooms', { body: { title: 't' }, ip: '1.1.1.1' })).status).toBe(429);
    expect((await h.call('POST', '/api/rooms', { body: { title: 't' }, ip: '2.2.2.2' })).status).toBe(201);
  });

  it('answer save: 10 per minute per token', async () => {
    const h = makeHarness({ rateLimiter: new MemoryRateLimiter() });
    const { roomId, members } = await h.setupRoom(['A']);
    const save = (ip: string) =>
      h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: members.A!.token }, body: { choice: 'yes' }, ip });
    for (let i = 0; i < 10; i++) expect((await save(`10.0.0.${i}`)).status).toBe(200);
    expect((await save('10.0.0.99')).status).toBe(429);
  });

  it('token-checking APIs: 60 per minute per address', async () => {
    const h = makeHarness({ rateLimiter: new MemoryRateLimiter() });
    const { roomId } = await h.setupRoom([]);
    for (let i = 0; i < 60; i++) {
      expect((await h.call('GET', `/api/rooms/${roomId}/me`, { tokens: { member: `guess${i}` }, ip: '9.9.9.9' })).status).toBe(404);
    }
    expect((await h.call('GET', `/api/rooms/${roomId}/me`, { tokens: { member: 'guess' }, ip: '9.9.9.9' })).status).toBe(429);
  });
});

describe('headers', () => {
  it('sets Referrer-Policy and no-store', async () => {
    const h = makeHarness();
    const res = await h.call('GET', '/healthz');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('CORS allows only configured origins', async () => {
    const h = makeHarness();
    const ok = await h.call('OPTIONS', '/api/rooms', {
      headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const bad = await h.call('OPTIONS', '/api/rooms', {
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('unknown paths → 404 JSON', async () => {
    const h = makeHarness();
    const res = await h.call('GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('not_found');
  });
});
