import { describe, expect, it } from 'vitest';
import { makeHarness } from '../support/http.js';

describe('end-to-end: create → invite → claim → answer → close → result → reopen', () => {
  it('runs the spec §6.4 chain example over HTTP', async () => {
    const h = makeHarness();
    const created = await h.call('POST', '/api/rooms', { body: { title: '太郎＆花子 結婚式', deadlineText: '12月20日', message: 'ぜひ' } });
    expect(created.status).toBe(201);
    const { roomId, adminToken } = created.json;
    const admin = { admin: adminToken };

    const ids: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    for (const name of ['A', 'B', 'C', 'D']) {
      const added = await h.call('POST', `/api/rooms/${roomId}/members`, { tokens: admin, body: { name } });
      expect(added.status).toBe(201);
      ids[name] = added.json.member.id;
      const claim = await h.call('POST', `/api/rooms/${roomId}/claim`, { tokens: { invite: added.json.member.inviteToken } });
      expect(claim.status).toBe(200);
      tokens[name] = claim.json.memberToken;
    }

    const save = (name: string, body: unknown) =>
      h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: tokens[name]! }, body });

    expect((await save('A', { choice: 'yes' })).status).toBe(200);
    expect((await save('B', { choice: 'cond', patterns: [{ people: [ids.A!, ids.C!], need: 2, minTotal: 0 }] })).status).toBe(200);
    expect((await save('C', { choice: 'cond', patterns: [{ people: [], need: 0, minTotal: 3 }] })).status).toBe(200);
    expect((await save('D', { choice: 'cond', patterns: [{ people: [ids.B!], need: 1, minTotal: 0 }] })).status).toBe(200);

    const before = await h.call('GET', `/api/rooms/${roomId}/admin`, { tokens: admin });
    expect(before.json.unansweredCount).toBe(0);
    expect(before.json.members.every((m: { inviteUsed: boolean }) => m.inviteUsed)).toBe(true);

    const closed = await h.call('POST', `/api/rooms/${roomId}/close`, { tokens: admin });
    expect(closed.json.result.attending).toEqual([ids.A, ids.B, ids.C, ids.D]);

    const dView = await h.call('GET', `/api/rooms/${roomId}/me`, { tokens: { member: tokens.D! } });
    expect(dView.json.result.attending).toHaveLength(4);

    // Reopen, C tightens the condition → the chain collapses to A only.
    const reopened = await h.call('POST', `/api/rooms/${roomId}/reopen`, { tokens: admin });
    expect(reopened.json.result).toBeNull();
    const cAgain = await save('C', { choice: 'cond', patterns: [{ people: [], need: 0, minTotal: 3 }] });
    expect(cAgain.json.me.saveCount).toBe(2);
    // M is at most (members − 1) = 3, so to express "4 others" add a member E who declines.
    const e = await h.call('POST', `/api/rooms/${roomId}/members`, { tokens: admin, body: { name: 'E' } });
    const eClaim = await h.call('POST', `/api/rooms/${roomId}/claim`, { tokens: { invite: e.json.member.inviteToken } });
    await h.call('PUT', `/api/rooms/${roomId}/me/answer`, { tokens: { member: eClaim.json.memberToken }, body: { choice: 'no' } });
    expect((await save('C', { choice: 'cond', patterns: [{ people: [], need: 0, minTotal: 4 }] })).status).toBe(200);

    const closed2 = await h.call('POST', `/api/rooms/${roomId}/close`, { tokens: admin });
    expect(closed2.json.result.attending).toEqual([ids.A]);

    // With an OR-pattern ("4 others, or A comes") C no longer breaks the chain.
    await h.call('POST', `/api/rooms/${roomId}/reopen`, { tokens: admin });
    const cOr = await save('C', {
      choice: 'cond',
      patterns: [
        { people: [], need: 0, minTotal: 4 },
        { people: [ids.A!], need: 1, minTotal: 0 },
      ],
    });
    expect(cOr.status).toBe(200);
    const closed3 = await h.call('POST', `/api/rooms/${roomId}/close`, { tokens: admin });
    expect(closed3.json.result.attending).toEqual([ids.A, ids.B, ids.C, ids.D]);
  });
});
