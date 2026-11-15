import { beforeEach, describe, expect, it } from 'vitest';
import type { UnitOfWork } from '../../src/application/ports/persistence.js';
import * as A from '../../src/application/usecases/admin.js';
import * as M from '../../src/application/usecases/member.js';
import { AppError } from '../../src/domain/errors.js';
import { admin, invite, makeDeps, member, type TestDeps } from './deps.js';

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
      expect(v.room).toEqual({ title: '結婚式', deadlineText: '12月20日', message: 'よろしく', status: 'open' });
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
        condPeople: [b.id],
        condNeed: 1,
      });
      expect(v.me.saveCount).toBe(2);
      expect(v.me.answer).toMatchObject({ choice: 'cond', condPeople: [b.id], condNeed: 1, condMinTotal: 0 });
      expect(v.members.map((m) => m.answered)).toEqual([true, false]);

      const bv = await M.getMemberView(d, roomId, member(b.token));
      expect(bv.me.answer).toBeNull();
      expect(JSON.stringify(bv)).not.toContain('"cond"');
    });

    it('validates answers', async () => {
      const a = await addAndClaim('A');
      expect(await code(M.saveAnswer(d, roomId, member(a.token), { choice: 'cond', condPeople: [a.id], condNeed: 1 }))).toBe(
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
      await M.saveAnswer(d, roomId, member(a.token), { choice: 'cond', condPeople: [b.id], condNeed: 1 });
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
      await M.saveAnswer(d, roomId, member(a.token), { choice: 'cond', condPeople: [b.id], condNeed: 1 });
      await M.saveAnswer(d, roomId, member(b.token), { choice: 'cond', condPeople: [a.id], condNeed: 1 });
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
  });
}
