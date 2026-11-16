import type { ClaimResponse, MemberViewResponse, SaveAnswerRequest } from '@himitsu/contracts';
import { hasStaleCondition, validateAnswer } from '../../domain/answerRules.js';
import { inviteUsed, notFound, roomClosed, validation } from '../../domain/errors.js';
import { acceptsChanges } from '../../domain/roomRules.js';
import type { Member, Room } from '../../domain/types.js';
import { authorize, type Credential } from '../authorize.js';
import type { Deps } from '../deps.js';
import type { Tx } from '../ports/persistence.js';
import { memberSummary, ownAnswer, resultView, roomInfo } from '../views.js';
import { ensureClosedIfDue } from './closing.js';

/**
 * F-06 / §8.2: exchange a one-time invite token for a member token.
 * Only the hash of the member token is stored; the raw token is returned exactly once.
 */
export async function claimInvite(deps: Deps, roomId: string, cred: Credential): Promise<ClaimResponse> {
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    const { member } = await authorize(tx, deps.tokens, 'invite', room, cred);
    if (room.inviteMode !== 'individual') throw notFound();
    if (member.inviteUsedAt !== null) throw inviteUsed();

    const memberToken = deps.tokens.generate();
    const now = deps.clock.now();
    const ok = await tx.members.claimInvite(roomId, member.id, deps.tokens.hash(memberToken), now);
    if (!ok) throw inviteUsed();
    await tx.audit.append({ roomId, memberId: member.id, actor: 'member', action: 'invite_claimed', createdAt: now });
    return { memberToken };
  });
}

async function buildMemberView(tx: Tx, room: Room, me: Member): Promise<MemberViewResponse> {
  const members = await tx.members.listByRoom(room.id);
  const answers = await tx.answers.listByRoom(room.id);
  const answered = new Set(answers.map((a) => a.memberId));
  const mine = answers.find((a) => a.memberId === me.id) ?? null;
  const memberIds = members.map((m) => m.id);
  const saveCount = await tx.audit.countAnswerSavesSinceLastClaim(room.id, me.id);
  const result = await tx.results.find(room.id);

  return {
    room: roomInfo(room),
    members: members.map((m) => memberSummary(m, answered)),
    me: {
      id: me.id,
      answer: mine ? ownAnswer(mine) : null,
      saveCount,
      claimedAt: me.inviteUsedAt ? me.inviteUsedAt.toISOString() : null,
      conditionNotice: mine ? hasStaleCondition(mine.patterns, memberIds) : false,
    },
    result: resultView(room, result, members),
  };
}

/** GET me: room info, statuses, and only the caller's own answer. */
export async function getMemberView(deps: Deps, roomId: string, cred: Credential): Promise<MemberViewResponse> {
  await ensureClosedIfDue(deps, roomId);
  return deps.uow.read(async (tx) => {
    const room = await tx.rooms.findById(roomId);
    if (!room) throw notFound();
    const { member } = await authorize(tx, deps.tokens, 'member', room, cred);
    return buildMemberView(tx, room, member);
  });
}

/** F-08〜F-10: the member is identified by the token only, never by the request body. */
export async function saveAnswer(
  deps: Deps,
  roomId: string,
  cred: Credential,
  input: SaveAnswerRequest,
): Promise<MemberViewResponse> {
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    const { member } = await authorize(tx, deps.tokens, 'member', room, cred);
    // Past the automatic deadline counts as closed even before the scheduled close runs.
    if (!acceptsChanges(room, deps.clock.now())) throw roomClosed();

    const members = await tx.members.listByRoom(roomId);
    const checked = validateAnswer(input, { selfId: member.id, memberIds: members.map((m) => m.id) });
    if (!checked.ok) throw validation(checked.fields);

    const now = deps.clock.now();
    await tx.answers.upsert({ memberId: member.id, ...checked.value, updatedAt: now });
    await tx.audit.append({ roomId, memberId: member.id, actor: 'member', action: 'answer_saved', createdAt: now });
    return buildMemberView(tx, room, member);
  });
}
