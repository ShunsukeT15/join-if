import { beforeEach, describe, expect, it } from 'vitest';
import type { UnitOfWork } from '../../src/application/ports/persistence.js';
import * as A from '../../src/application/usecases/admin.js';
import { closeDueRooms } from '../../src/application/usecases/closing.js';
import * as E from '../../src/application/usecases/event.js';
import * as G from '../../src/application/usecases/group.js';
import * as M from '../../src/application/usecases/member.js';
import { AppError } from '../../src/domain/errors.js';
import { admin, group, invite, makeDeps, member, type TestDeps } from './deps.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

/**
 * Behavioural suite for the application layer. It runs against every persistence
 * adapter, so it doubles as the adapter contract test.
 */
export function defineUseCaseSuite(label: string, makeUow: () => Promise<UnitOfWork>) {
  describe(`use cases [${label}]`, () => {
    let d: TestDeps;
    let roomId: string;
    let adminToken: string;

    const addAndClaim = async (name: string) => {
      const { member: m } = await A.addMember(d, roomId, admin(adminToken), { name });
      const { memberToken } = await M.claimInvite(d, roomId, invite(m.inviteToken));
      return { id: m.id, token: memberToken, inviteToken: m.inviteToken! };
    };

    beforeEach(async () => {
      d = makeDeps(await makeUow());
      ({ roomId, adminToken } = await A.createRoom(d, { title: ' 結婚式 ', deadlineText: '12月20日', message: 'よろしく' }));
    });

    it('creates a room and shows it to the admin', async () => {
      const v = await A.getAdminView(d, roomId, admin(adminToken));
      expect(v.room).toEqual({
        title: '結婚式',
        deadlineText: '12月20日',
        message: 'よろしく',
        status: 'open',
        inviteMode: 'individual',
        deadlineAt: null,
        communityName: null,
      });
      expect(v.members).toEqual([]);
      expect(v.result).toBeNull();
    });

    it('rejects a wrong admin token as not_found', async () => {
      expect(await code(A.getAdminView(d, roomId, admin('x')))).toBe('not_found');
      expect(await code(A.getAdminView(d, roomId, admin(undefined)))).toBe('not_found');
      expect(await code(A.getAdminView(d, 'nope', admin(adminToken)))).toBe('not_found');
    });

    it('updates settings', async () => {
      const v = await A.updateSettings(d, roomId, admin(adminToken), { title: '同窓会' });
      expect(v.room.title).toBe('同窓会');
      expect(v.room.message).toBe('よろしく');
      expect(await code(A.updateSettings(d, roomId, admin(adminToken), { title: '  ' }))).toBe('validation');
    });

    it('adds members with unique names and shows unused invite tokens', async () => {
      const { member: m } = await A.addMember(d, roomId, admin(adminToken), { name: '佐藤' });
      expect(m.inviteToken).toBeTruthy();
      expect(await code(A.addMember(d, roomId, admin(adminToken), { name: ' 佐藤 ' }))).toBe('validation');
      const v = await A.getAdminView(d, roomId, admin(adminToken));
      expect(v.members).toEqual([{ id: m.id, name: '佐藤', answered: false, inviteToken: m.inviteToken, inviteUsed: false }]);
    });

    it('caps members at 100', async () => {
      for (let i = 0; i < 100; i++) await A.addMember(d, roomId, admin(adminToken), { name: `m${i}` });
      expect(await code(A.addMember(d, roomId, admin(adminToken), { name: 'over' }))).toBe('validation');
    });

    it('claims an invite once; the admin then only sees "used"', async () => {
      const { member: m } = await A.addMember(d, roomId, admin(adminToken), { name: '佐藤' });
      const { memberToken } = await M.claimInvite(d, roomId, invite(m.inviteToken));
      expect(memberToken).toBeTruthy();
      expect(await code(M.claimInvite(d, roomId, invite(m.inviteToken)))).toBe('invite_used');

      const v = await A.getAdminView(d, roomId, admin(adminToken));
      expect(v.members[0]).toEqual({ id: m.id, name: '佐藤', answered: false, inviteUsed: true });

      const me = await M.getMemberView(d, roomId, member(memberToken));
      expect(me.me.claimedAt).toBe(d.clock.now().toISOString());
      expect(me.me.answer).toBeNull();
    });

    it('serializes concurrent claims: exactly one succeeds', async () => {
      const { member: m } = await A.addMember(d, roomId, admin(adminToken), { name: '佐藤' });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => code(M.claimInvite(d, roomId, invite(m.inviteToken)))),
      );
      expect(results.filter((r) => r === 'ok')).toHaveLength(1);
      expect(results.filter((r) => r === 'invite_used')).toHaveLength(4);
    });

    it('saves answers, counts saves, and reports own answer only', async () => {
      const a = await addAndClaim('A');
      const b = await addAndClaim('B');
      await M.saveAnswer(d, roomId, member(a.token), { choice: 'yes' });
      d.clock.advance(60_000);
      const v = await M.saveAnswer(d, roomId, member(a.token), {
        choice: 'cond',
        patterns: [{ people: [b.id], need: 1, minTotal: 0 }],
      });
      expect(v.me.saveCount).toBe(2);
      expect(v.me.answer).toMatchObject({ choice: 'cond', patterns: [{ people: [b.id], need: 1, minTotal: 0 }] });
      expect(v.members.map((m) => m.answered)).toEqual([true, false]);

      const bv = await M.getMemberView(d, roomId, member(b.token));
      expect(bv.me.answer).toBeNull();
      expect(JSON.stringify(bv)).not.toContain('"cond"');
    });

    it('stores and returns OR-patterns, and closes with them', async () => {
      const a = await addAndClaim('A');
      const b = await addAndClaim('B');
      const c = await addAndClaim('C');
      const x = await addAndClaim('X');
      const patterns = [
        { people: [a.id, b.id], need: 2, minTotal: 0 },
        { people: [b.id, c.id], need: 2, minTotal: 0 },
      ];
      const v = await M.saveAnswer(d, roomId, member(x.token), { choice: 'cond', patterns });
      expect(v.me.answer?.patterns).toEqual(patterns);
      expect((await M.getMemberView(d, roomId, member(x.token))).me.answer?.patterns).toEqual(patterns);

      await M.saveAnswer(d, roomId, member(a.token), { choice: 'no' });
      await M.saveAnswer(d, roomId, member(b.token), { choice: 'yes' });
      await M.saveAnswer(d, roomId, member(c.token), { choice: 'yes' });
      const closed = await A.closeRoom(d, roomId, admin(adminToken));
      expect([...closed.result!.attending].sort()).toEqual([b.id, c.id, x.id].sort());
    });

    it('validates answers', async () => {
      const a = await addAndClaim('A');
      expect(await code(M.saveAnswer(d, roomId, member(a.token), { choice: 'cond', patterns: [{ people: [a.id], need: 1, minTotal: 0 }] }))).toBe(
        'validation',
      );
      expect(await code(M.saveAnswer(d, roomId, member(a.token), { choice: 'cond' }))).toBe('validation');
    });

    it('reissue invalidates old URLs and deletes the answer', async () => {
      const a = await addAndClaim('A');
      await M.saveAnswer(d, roomId, member(a.token), { choice: 'yes' });
      const { member: re } = await A.reissueInvite(d, roomId, admin(adminToken), a.id);
      expect(re.inviteToken).not.toBe(a.inviteToken);
      expect(re.answered).toBe(false);

      expect(await code(M.getMemberView(d, roomId, member(a.token)))).toBe('not_found');
      expect(await code(M.claimInvite(d, roomId, invite(a.inviteToken)))).toBe('not_found');

      const { memberToken } = await M.claimInvite(d, roomId, invite(re.inviteToken));
      const v = await M.getMemberView(d, roomId, member(memberToken));
      expect(v.me.answer).toBeNull();
      expect(v.me.saveCount).toBe(0);
    });

    it('removing a member deletes their answer and flags dependent answers', async () => {
      const a = await addAndClaim('A');
      const b = await addAndClaim('B');
      await M.saveAnswer(d, roomId, member(b.token), { choice: 'yes' });
      await M.saveAnswer(d, roomId, member(a.token), { choice: 'cond', patterns: [{ people: [b.id], need: 1, minTotal: 0 }] });
      await A.removeMember(d, roomId, admin(adminToken), b.id);

      expect(await code(M.getMemberView(d, roomId, member(b.token)))).toBe('not_found');
      const v = await M.getMemberView(d, roomId, member(a.token));
      expect(v.me.conditionNotice).toBe(true);
      expect(v.members.map((m) => m.name)).toEqual(['A']);
      const adminView = await A.getAdminView(d, roomId, admin(adminToken));
      expect(JSON.stringify(adminView)).not.toContain('conditionNotice');

      const closed = await A.closeRoom(d, roomId, admin(adminToken));
      expect(closed.result?.attending).toEqual([]);
    });

    it('closes, computes, blocks writes, and reopens keeping answers', async () => {
      const a = await addAndClaim('A');
      const b = await addAndClaim('B');
      const c = await addAndClaim('C');
      await addAndClaim('D'); // unanswered
      await M.saveAnswer(d, roomId, member(a.token), { choice: 'cond', patterns: [{ people: [b.id], need: 1, minTotal: 0 }] });
      await M.saveAnswer(d, roomId, member(b.token), { choice: 'cond', patterns: [{ people: [a.id], need: 1, minTotal: 0 }] });
      await M.saveAnswer(d, roomId, member(c.token), { choice: 'no' });

      const before = await A.getAdminView(d, roomId, admin(adminToken));
      expect(before.unansweredCount).toBe(1);

      const v = await A.closeRoom(d, roomId, admin(adminToken));
      expect(v.room.status).toBe('closed');
      expect(v.result?.attending).toEqual([a.id, b.id]);

      const mv = await M.getMemberView(d, roomId, member(c.token));
      expect(mv.result?.attending).toEqual([a.id, b.id]);

      expect(await code(M.saveAnswer(d, roomId, member(a.token), { choice: 'yes' }))).toBe('closed');
      expect(await code(A.reissueInvite(d, roomId, admin(adminToken), a.id))).toBe('closed');
      expect(await code(A.addMember(d, roomId, admin(adminToken), { name: 'E' }))).toBe('closed');
      expect(await code(A.removeMember(d, roomId, admin(adminToken), a.id))).toBe('closed');
      expect(await code(A.closeRoom(d, roomId, admin(adminToken)))).toBe('conflict');

      const r = await A.reopenRoom(d, roomId, admin(adminToken));
      expect(r.result).toBeNull();
      expect(r.room.status).toBe('open');
      const av = await M.getMemberView(d, roomId, member(a.token));
      expect(av.me.answer?.choice).toBe('cond');
      expect(av.result).toBeNull();
    });

    it('serializes close vs. save: a save after close is rejected', async () => {
      const a = await addAndClaim('A');
      const [closeRes, saveRes] = await Promise.all([
        code(A.closeRoom(d, roomId, admin(adminToken))),
        code(M.saveAnswer(d, roomId, member(a.token), { choice: 'yes' })),
      ]);
      expect(closeRes).toBe('ok');
      const v = await A.getAdminView(d, roomId, admin(adminToken));
      if (saveRes === 'ok') {
        // Save was ordered first, so it must be reflected in the result.
        expect(v.result?.attending).toEqual([a.id]);
      } else {
        expect(saveRes).toBe('closed');
        expect(v.result?.attending).toEqual([]);
      }
    });

    it('purges rooms 90 days after closing', async () => {
      await A.closeRoom(d, roomId, admin(adminToken));
      d.clock.advanceDays(89);
      expect(await A.purgeExpiredRooms(d)).toBe(0);
      d.clock.advanceDays(2);
      expect(await A.purgeExpiredRooms(d)).toBe(1);
      expect(await code(A.getAdminView(d, roomId, admin(adminToken)))).toBe('not_found');
    });

    it('purges never-closed rooms after a year', async () => {
      d.clock.advanceDays(366);
      expect(await A.purgeExpiredRooms(d)).toBe(1);
    });

    it('cross-room tokens are rejected', async () => {
      const other = await A.createRoom(d, { title: 'other' });
      const a = await addAndClaim('A');
      expect(await code(A.getAdminView(d, other.roomId, admin(adminToken)))).toBe('not_found');
      expect(await code(M.getMemberView(d, other.roomId, member(a.token)))).toBe('not_found');
      expect(await code(A.removeMember(d, other.roomId, admin(other.adminToken), a.id))).toBe('not_found');
      expect(await code(A.reissueInvite(d, other.roomId, admin(other.adminToken), a.id))).toBe('not_found');
      // wrong credential kind
      expect(await code(M.getMemberView(d, roomId, admin(adminToken)))).toBe('not_found');
      expect(await code(A.getAdminView(d, roomId, member(a.token)))).toBe('not_found');
    });
    describe(`group invitation [${label}]`, () => {
    let d: TestDeps;
    let roomId: string;
    let adminToken: string;
    let groupToken: string;

    beforeEach(async () => {
      d = makeDeps(await makeUow());
      ({ roomId, adminToken } = await A.createRoom(d, { title: '同窓会', inviteMode: 'group' }));
      groupToken = (await A.getAdminView(d, roomId, admin(adminToken))).groupToken!;
    });

    const add = async (name: string) => (await A.addMember(d, roomId, admin(adminToken), { name })).member.id;

    it('issues one group URL and no per-member invite URLs', async () => {
      await add('A');
      const v = await A.getAdminView(d, roomId, admin(adminToken));
      expect(v.room.inviteMode).toBe('group');
      expect(groupToken).toBeTruthy();
      expect(v.members[0]).toEqual({ id: v.members[0]!.id, name: 'A', answered: false, inviteUsed: false });
    });

    it('a name can be picked once; the group view shows only taken/not taken', async () => {
      const a = await add('A');
      await add('B');
      const { memberToken } = await G.claimName(d, roomId, group(groupToken), { memberId: a });
      expect(memberToken).toBeTruthy();
      expect(await code(G.claimName(d, roomId, group(groupToken), { memberId: a }))).toBe('invite_used');

      await M.saveAnswer(d, roomId, member(memberToken), { choice: 'yes' });
      const gv = await G.getGroupView(d, roomId, group(groupToken));
      expect(gv.members.map((m) => [m.name, m.taken])).toEqual([
        ['A', true],
        ['B', false],
      ]);
      expect(Object.keys(gv.members[0]!).sort()).toEqual(['id', 'name', 'taken']);
      expect(JSON.stringify(gv)).not.toMatch(/answered|choice|patterns/);

      const admView = await A.getAdminView(d, roomId, admin(adminToken));
      expect(admView.members.find((m) => m.id === a)?.inviteUsed).toBe(true);
    });

    it('concurrent picks of the same name: exactly one wins', async () => {
      const a = await add('A');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => code(G.claimName(d, roomId, group(groupToken), { memberId: a }))),
      );
      expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    });

    it('reset lets the name be picked again and drops the old URL and answer', async () => {
      const a = await add('A');
      const first = await G.claimName(d, roomId, group(groupToken), { memberId: a });
      await M.saveAnswer(d, roomId, member(first.memberToken), { choice: 'yes' });
      await A.reissueInvite(d, roomId, admin(adminToken), a);

      expect(await code(M.getMemberView(d, roomId, member(first.memberToken)))).toBe('not_found');
      expect((await G.getGroupView(d, roomId, group(groupToken))).members[0]!.taken).toBe(false);
      const second = await G.claimName(d, roomId, group(groupToken), { memberId: a });
      expect((await M.getMemberView(d, roomId, member(second.memberToken))).me.answer).toBeNull();
    });

    it('reissuing the group URL invalidates the old one but keeps picked members', async () => {
      const a = await add('A');
      const picked = await G.claimName(d, roomId, group(groupToken), { memberId: a });
      const { groupToken: next } = await A.reissueGroupToken(d, roomId, admin(adminToken));
      expect(next).not.toBe(groupToken);
      expect(await code(G.getGroupView(d, roomId, group(groupToken)))).toBe('not_found');
      expect((await G.getGroupView(d, roomId, group(next))).members).toHaveLength(1);
      expect((await M.getMemberView(d, roomId, member(picked.memberToken))).me.id).toBe(a);
    });

    it('group token cannot claim in an individual room, nor reach another room', async () => {
      const other = await A.createRoom(d, { title: 'indiv' });
      const z = (await A.addMember(d, other.roomId, admin(other.adminToken), { name: 'Z' })).member.id;
      expect(await code(G.getGroupView(d, other.roomId, group(groupToken)))).toBe('not_found');
      expect(await code(G.claimName(d, roomId, group(groupToken), { memberId: z }))).toBe('not_found');
      expect(await code(A.reissueGroupToken(d, other.roomId, admin(other.adminToken)))).toBe('not_found');
    });
  });

  describe(`automatic deadline [${label}]`, () => {
    let d: TestDeps;
    const inHours = (h: number) => new Date(d.clock.now().getTime() + h * 3_600_000).toISOString();

    beforeEach(async () => {
      d = makeDeps(await makeUow());
    });

    const setup = async (deadlineAt: string) => {
      const { roomId, adminToken } = await A.createRoom(d, { title: '旅行', deadlineAt });
      const { member: m } = await A.addMember(d, roomId, admin(adminToken), { name: 'A' });
      const { memberToken } = await M.claimInvite(d, roomId, invite(m.inviteToken));
      return { roomId, adminToken, memberToken, memberId: m.id };
    };

    it('validates the deadline', async () => {
      expect(await code(A.createRoom(d, { title: 't', deadlineAt: inHours(-1) }))).toBe('validation');
      expect(await code(A.createRoom(d, { title: 't', deadlineAt: inHours(24 * 400) }))).toBe('validation');
      expect(await code(A.createRoom(d, { title: 't', deadlineAt: 'tomorrow' }))).toBe('validation');
      const ok = await A.createRoom(d, { title: 't', deadlineAt: inHours(2) });
      expect((await A.getAdminView(d, ok.roomId, admin(ok.adminToken))).room.deadlineAt).toBe(inHours(2));
    });

    it('stops accepting answers at the deadline and closes when the room is opened', async () => {
      const r = await setup(inHours(1));
      await M.saveAnswer(d, r.roomId, member(r.memberToken), { choice: 'yes' });
      d.clock.advance(3_600_000);
      expect(await code(M.saveAnswer(d, r.roomId, member(r.memberToken), { choice: 'no' }))).toBe('closed');
      expect(await code(A.addMember(d, r.roomId, admin(r.adminToken), { name: 'B' }))).toBe('closed');

      const v = await M.getMemberView(d, r.roomId, member(r.memberToken));
      expect(v.room.status).toBe('closed');
      expect(v.result?.attending).toEqual([r.memberId]);
    });

    it('the scheduled job closes only rooms past their deadline', async () => {
      const due = await setup(inHours(1));
      const later = await setup(inHours(5));
      const manual = await A.createRoom(d, { title: 'manual' });
      d.clock.advance(2 * 3_600_000);
      expect(await closeDueRooms(d)).toBe(1);
      expect(await closeDueRooms(d)).toBe(0);
      expect((await A.getAdminView(d, due.roomId, admin(due.adminToken))).room.status).toBe('closed');
      expect((await A.getAdminView(d, later.roomId, admin(later.adminToken))).room.status).toBe('open');
      expect((await A.getAdminView(d, manual.roomId, admin(manual.adminToken))).room.status).toBe('open');
    });

    it('reopening after an automatic close clears the past deadline', async () => {
      const r = await setup(inHours(1));
      d.clock.advance(2 * 3_600_000);
      await closeDueRooms(d);
      const v = await A.reopenRoom(d, r.roomId, admin(r.adminToken));
      expect(v.room.status).toBe('open');
      expect(v.room.deadlineAt).toBeNull();
      expect(await closeDueRooms(d)).toBe(0);
    });

    it('the deadline can be changed or removed', async () => {
      const r = await setup(inHours(1));
      expect((await A.updateSettings(d, r.roomId, admin(r.adminToken), { deadlineAt: inHours(3) })).room.deadlineAt).toBe(inHours(3));
      expect((await A.updateSettings(d, r.roomId, admin(r.adminToken), { deadlineAt: null })).room.deadlineAt).toBeNull();
      expect((await A.updateSettings(d, r.roomId, admin(r.adminToken), { title: 'x' })).room.deadlineAt).toBeNull();
      d.clock.advance(5 * 3_600_000);
      expect(await closeDueRooms(d)).toBe(0);
    });
  });
  describe(`events with communities [${label}]`, () => {
    let d: TestDeps;
    let eventId: string;
    let token: string;

    beforeEach(async () => {
      d = makeDeps(await makeUow());
      ({ eventId, adminToken: token } = await E.createEvent(d, { title: '太郎＆花子 結婚式', message: 'よろしく' }));
    });

    const community = async (name: string, members: string[]) => {
      const { roomId } = await E.addCommunity(d, eventId, admin(token), { name });
      const tokens: Record<string, string> = {};
      for (const m of members) {
        const { member: added } = await A.addMember(d, roomId, admin(token), { name: m });
        tokens[m] = (await M.claimInvite(d, roomId, invite(added.inviteToken))).memberToken;
      }
      return { roomId, tokens };
    };

    it('the event token manages every community; members see only their community', async () => {
      const a = await community('新郎友人', ['A1', 'A2']);
      const b = await community('新婦同僚', ['B1']);
      const view = await A.getAdminView(d, a.roomId, admin(token));
      expect(view.event).toEqual({ id: eventId, title: '太郎＆花子 結婚式' });
      expect(view.room).toMatchObject({ title: '太郎＆花子 結婚式', communityName: '新郎友人', message: 'よろしく' });

      const mv = await M.getMemberView(d, a.roomId, member(a.tokens.A1));
      expect(mv.members.map((m) => m.name)).toEqual(['A1', 'A2']);
      expect(await code(M.getMemberView(d, b.roomId, member(a.tokens.A1)))).toBe('not_found');
    });

    it('aggregates per community and in total; each community closes on its own', async () => {
      const a = await community('新郎友人', ['A1', 'A2']);
      const b = await community('新婦同僚', ['B1', 'B2']);
      await M.saveAnswer(d, a.roomId, member(a.tokens.A1), { choice: 'yes' });
      await M.saveAnswer(d, a.roomId, member(a.tokens.A2), { choice: 'no' });
      await M.saveAnswer(d, b.roomId, member(b.tokens.B1), { choice: 'yes' });
      await A.closeRoom(d, a.roomId, admin(token));

      const ev = await E.getEventAdminView(d, eventId, admin(token));
      expect(ev.communities.map((c) => [c.name, c.status, c.memberCount, c.answeredCount, c.attendingCount])).toEqual([
        ['新郎友人', 'closed', 2, 2, 1],
        ['新婦同僚', 'open', 2, 1, null],
      ]);
      expect(ev.totals).toEqual({ memberCount: 4, answeredCount: 3, attendingCount: 1, closedCount: 1 });
      expect(ev.attendees).toEqual([{ name: 'A1', community: '新郎友人' }]);
      // Open communities never reveal who will attend.
      expect(JSON.stringify(ev)).not.toContain('B1');
    });

    it('auto-closes communities past their deadline when the event is viewed', async () => {
      const { roomId } = await E.addCommunity(d, eventId, admin(token), {
        name: 'サークル',
        deadlineAt: new Date(d.clock.now().getTime() + 3_600_000).toISOString(),
      });
      d.clock.advance(2 * 3_600_000);
      const ev = await E.getEventAdminView(d, eventId, admin(token));
      expect(ev.communities.find((c) => c.roomId === roomId)?.status).toBe('closed');
    });

    it('renaming the event updates every community title', async () => {
      const a = await community('新郎友人', ['A1']);
      await E.updateEvent(d, eventId, admin(token), { title: '披露宴' });
      expect((await M.getMemberView(d, a.roomId, member(a.tokens.A1))).room.title).toBe('披露宴');
    });

    it('community names: unique, editable from the community, title not editable there', async () => {
      const a = await community('新郎友人', []);
      expect(await code(E.addCommunity(d, eventId, admin(token), { name: '新郎友人' }))).toBe('validation');
      expect(await code(A.updateSettings(d, a.roomId, admin(token), { title: 'x' }))).toBe('validation');
      const v = await A.updateSettings(d, a.roomId, admin(token), { communityName: '大学の友人' });
      expect(v.room.communityName).toBe('大学の友人');
      const standalone = await A.createRoom(d, { title: 'single' });
      expect(await code(A.updateSettings(d, standalone.roomId, admin(standalone.adminToken), { communityName: 'x' }))).toBe('validation');
    });

    it('caps communities per event', async () => {
      for (let i = 0; i < 20; i++) await E.addCommunity(d, eventId, admin(token), { name: `c${i}` });
      expect(await code(E.addCommunity(d, eventId, admin(token), { name: 'over' }))).toBe('validation');
    });

    it('rejects other tokens', async () => {
      const other = await E.createEvent(d, { title: 'other' });
      const room = await A.createRoom(d, { title: 'single' });
      expect(await code(E.getEventAdminView(d, eventId, admin(other.adminToken)))).toBe('not_found');
      expect(await code(E.getEventAdminView(d, eventId, admin(room.adminToken)))).toBe('not_found');
      expect(await code(E.addCommunity(d, other.eventId, admin(token), { name: 'x' }))).toBe('not_found');
      expect(await code(E.getEventAdminView(d, 'nope', admin(token)))).toBe('not_found');
    });

    it('purges events after a year, and empty events after 30 days', async () => {
      const empty = await E.createEvent(d, { title: 'empty' });
      await community('c', ['A1']);
      d.clock.advanceDays(31);
      await A.purgeExpiredRooms(d);
      expect(await code(E.getEventAdminView(d, empty.eventId, admin(empty.adminToken)))).toBe('not_found');
      expect((await E.getEventAdminView(d, eventId, admin(token))).communities).toHaveLength(1);
      d.clock.advanceDays(340);
      await A.purgeExpiredRooms(d);
      expect(await code(E.getEventAdminView(d, eventId, admin(token)))).toBe('not_found');
    });
  });
});
}
