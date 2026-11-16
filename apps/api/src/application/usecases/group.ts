import type { ClaimResponse, GroupClaimRequest, GroupViewResponse } from '@himitsu/contracts';
import { nameTaken, notFound } from '../../domain/errors.js';
import { authorize, type Credential } from '../authorize.js';
import type { Deps } from '../deps.js';
import { roomInfo } from '../views.js';
import { ensureClosedIfDue } from './closing.js';

/**
 * Group mode: one shared URL for the whole group. A holder of the URL picks their own
 * name; each name can be picked once (first come), which issues a member URL known only
 * to that person — the same member URL as in individual mode.
 */

/** Names to pick from. Only whether a name is taken — never answers or answered status. */
export async function getGroupView(deps: Deps, roomId: string, cred: Credential): Promise<GroupViewResponse> {
  await ensureClosedIfDue(deps, roomId);
  return deps.uow.read(async (tx) => {
    const room = await tx.rooms.findById(roomId);
    if (!room) throw notFound();
    await authorize(tx, deps.tokens, 'group', room, cred);
    const members = await tx.members.listByRoom(roomId);
    return {
      room: roomInfo(room),
      members: members.map((m) => ({ id: m.id, name: m.displayName, taken: m.inviteUsedAt !== null })),
    };
  });
}

/** Picks a name. The second picker of the same name gets 410 (the organizer can reset it). */
export async function claimName(
  deps: Deps,
  roomId: string,
  cred: Credential,
  input: GroupClaimRequest,
): Promise<ClaimResponse> {
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'group', room, cred);
    // memberId comes from the body, so always look it up scoped to this room (spec §8.6-3).
    const member = await tx.members.findInRoom(roomId, input.memberId);
    if (!member) throw notFound();
    if (member.inviteUsedAt !== null) throw nameTaken();

    const memberToken = deps.tokens.generate();
    const now = deps.clock.now();
    const ok = await tx.members.claimInvite(roomId, member.id, deps.tokens.hash(memberToken), now);
    if (!ok) throw nameTaken();
    await tx.audit.append({ roomId, memberId: member.id, actor: 'member', action: 'invite_claimed', createdAt: now });
    return { memberToken };
  });
}
