import type {
  AdminMember,
  AnswerDto,
  MemberSummary,
  ResultDto,
  RoomInfo,
} from '@himitsu/contracts';
import type { Answer, Member, Result, Room } from '../domain/types.js';
import type { TokenService } from './ports/services.js';

/**
 * DTO mappers. Each view decides exactly which fields leave the server.
 * Nothing here ever maps another member's answer.
 */

export function roomInfo(room: Room): RoomInfo {
  return { title: room.title, deadlineText: room.deadlineText, message: room.message, status: room.status };
}

export function memberSummary(member: Member, answeredIds: ReadonlySet<string>): MemberSummary {
  return { id: member.id, name: member.displayName, answered: answeredIds.has(member.id) };
}

export function adminMember(member: Member, answeredIds: ReadonlySet<string>, tokens: TokenService): AdminMember {
  const base = memberSummary(member, answeredIds);
  if (member.inviteUsedAt === null && member.inviteTokenEnc !== null) {
    return { ...base, inviteToken: tokens.decrypt(member.inviteTokenEnc), inviteUsed: false };
  }
  return { ...base, inviteUsed: member.inviteUsedAt !== null };
}

/** Only for the owner of the answer. */
export function ownAnswer(answer: Answer): AnswerDto {
  return {
    choice: answer.choice,
    patterns: answer.patterns.map((p) => ({ people: [...p.people], need: p.need, minTotal: p.minTotal })),
    updatedAt: answer.updatedAt.toISOString(),
  };
}

/** Result shown only while closed. Carries no reasons (spec §2: "no" ≡ "condition unmet"). */
export function resultView(room: Room, result: Result | null, members: readonly Member[]): ResultDto | null {
  if (room.status !== 'closed' || !result) return null;
  const order = new Map(members.map((m, i) => [m.id, i]));
  const attending = result.attending
    .filter((id) => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  return { attending, computedAt: result.computedAt.toISOString() };
}
