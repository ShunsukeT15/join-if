import type {
  AddMemberResponse,
  AdminViewResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  ReissueResponse,
  UpdateSettingsRequest,
} from '@himitsu/contracts';
import {
  addDays,
  LIMITS,
  RETENTION_AFTER_CLOSE_DAYS,
  RETENTION_UNCLOSED_DAYS,
} from '../../domain/constants.js';
import { conflict, notFound, roomClosed, validation } from '../../domain/errors.js';
import { normalizeMemberName, normalizeSettings } from '../../domain/roomRules.js';
import { solve, type SolverAnswer } from '../../domain/solver.js';
import type { Member, Room } from '../../domain/types.js';
import { authorize, type Credential } from '../authorize.js';
import type { Deps } from '../deps.js';
import type { Tx } from '../ports/persistence.js';
import { adminMember, resultView, roomInfo } from '../views.js';

/** F-01: create a room and issue the admin token. */
export async function createRoom(deps: Deps, input: CreateRoomRequest): Promise<CreateRoomResponse> {
  const settings = normalizeSettings(
    { title: input.title, deadlineText: input.deadlineText ?? '', message: input.message ?? '' },
    { requireTitle: true },
  );
  const adminToken = deps.tokens.generate();
  const now = deps.clock.now();

  return deps.uow.transaction(async (tx) => {
    let id = deps.ids.roomId();
    for (let i = 0; i < 5 && (await tx.rooms.findById(id)); i++) id = deps.ids.roomId();
    const room: Room = {
      id,
      title: settings.title!,
      deadlineText: settings.deadlineText!,
      message: settings.message!,
      status: 'open',
      adminTokenHash: deps.tokens.hash(adminToken),
      createdAt: now,
      closedAt: null,
      purgeAfter: addDays(now, RETENTION_UNCLOSED_DAYS),
    };
    await tx.rooms.insert(room);
    return { roomId: id, adminToken };
  });
}

async function buildAdminView(deps: Deps, tx: Tx, room: Room): Promise<AdminViewResponse> {
  const members = await tx.members.listByRoom(room.id);
  const answers = await tx.answers.listByRoom(room.id);
  const answered = new Set(answers.map((a) => a.memberId));
  const result = await tx.results.find(room.id);
  return {
    room: roomInfo(room),
    members: members.map((m) => adminMember(m, answered, deps.tokens)),
    unansweredCount: members.filter((m) => !answered.has(m.id)).length,
    result: resultView(room, result, members),
  };
}

/** GET admin view: statuses only, never answer contents. */
export async function getAdminView(deps: Deps, roomId: string, cred: Credential): Promise<AdminViewResponse> {
  return deps.uow.read(async (tx) => {
    const room = await tx.rooms.findById(roomId);
    if (!room) throw notFound();
    await authorize(tx, deps.tokens, 'admin', room, cred);
    return buildAdminView(deps, tx, room);
  });
}

/** F-02 */
export async function updateSettings(
  deps: Deps,
  roomId: string,
  cred: Credential,
  input: UpdateSettingsRequest,
): Promise<AdminViewResponse> {
  const patch = normalizeSettings(input, { requireTitle: false });
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'admin', room, cred);
    const updated: Room = { ...room, ...patch };
    await tx.rooms.update(updated);
    await tx.audit.append({
      roomId,
      memberId: null,
      actor: 'admin',
      action: 'settings_changed',
      createdAt: deps.clock.now(),
    });
    return buildAdminView(deps, tx, updated);
  });
}

/** F-03 */
export async function addMember(
  deps: Deps,
  roomId: string,
  cred: Credential,
  input: { name: string },
): Promise<AddMemberResponse> {
  const name = normalizeMemberName(input.name);
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'admin', room, cred);
    if (room.status !== 'open') throw roomClosed();

    const members = await tx.members.listByRoom(roomId);
    if (members.length >= LIMITS.maxMembers) {
      throw validation({ name: `メンバーは${LIMITS.maxMembers}人までです` }, `メンバーは${LIMITS.maxMembers}人までです`);
    }
    if (members.some((m) => m.displayName === name)) {
      throw validation({ name: '同じ名前のメンバーがいます' });
    }

    const inviteToken = deps.tokens.generate();
    const now = deps.clock.now();
    const member: Member = {
      id: deps.ids.memberId(),
      roomId,
      displayName: name,
      inviteTokenHash: deps.tokens.hash(inviteToken),
      inviteTokenEnc: deps.tokens.encrypt(inviteToken),
      inviteUsedAt: null,
      memberTokenHash: null,
      sortOrder: members.reduce((max, m) => Math.max(max, m.sortOrder), 0) + 1,
      createdAt: now,
    };
    await tx.members.insert(member);
    await tx.audit.append({ roomId, memberId: member.id, actor: 'admin', action: 'member_added', createdAt: now });
    return { member: adminMember(member, new Set(), deps.tokens) };
  });
}

/** F-03 / §5.5: removing a member also removes their answer and invalidates their URLs. */
export async function removeMember(deps: Deps, roomId: string, cred: Credential, memberId: string): Promise<void> {
  await deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'admin', room, cred);
    const member = await tx.members.findInRoom(roomId, memberId);
    if (!member) throw notFound();
    if (room.status !== 'open') throw roomClosed();
    await tx.answers.delete(member.id);
    await tx.members.delete(roomId, member.id);
    await tx.audit.append({
      roomId,
      memberId: member.id,
      actor: 'admin',
      action: 'member_removed',
      createdAt: deps.clock.now(),
    });
  });
}

/** F-05 / §5.6: new invite URL; old invite + member URL become invalid and the answer is deleted. */
export async function reissueInvite(
  deps: Deps,
  roomId: string,
  cred: Credential,
  memberId: string,
): Promise<ReissueResponse> {
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'admin', room, cred);
    const member = await tx.members.findInRoom(roomId, memberId);
    if (!member) throw notFound();
    if (room.status !== 'open') throw roomClosed();

    const inviteToken = deps.tokens.generate();
    const updated: Member = {
      ...member,
      inviteTokenHash: deps.tokens.hash(inviteToken),
      inviteTokenEnc: deps.tokens.encrypt(inviteToken),
      inviteUsedAt: null,
      memberTokenHash: null,
    };
    await tx.answers.delete(member.id);
    await tx.members.update(updated);
    await tx.audit.append({
      roomId,
      memberId: member.id,
      actor: 'admin',
      action: 'invite_reissued',
      createdAt: deps.clock.now(),
    });
    return { member: adminMember(updated, new Set(), deps.tokens) };
  });
}

/** F-13 / F-14: close and compute on the server. Unanswered members are treated as absent. */
export async function closeRoom(deps: Deps, roomId: string, cred: Credential): Promise<AdminViewResponse> {
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'admin', room, cred);
    if (room.status === 'closed') throw conflict('すでに締め切られています');

    const members = await tx.members.listByRoom(roomId);
    const answers = await tx.answers.listByRoom(roomId);
    const map = new Map<string, SolverAnswer>(answers.map((a) => [a.memberId, a]));
    const attending = solve(
      members.map((m) => m.id),
      map,
    );

    const now = deps.clock.now();
    await tx.results.save({ roomId, attending: [...attending], computedAt: now });
    const updated: Room = {
      ...room,
      status: 'closed',
      closedAt: now,
      purgeAfter: addDays(now, RETENTION_AFTER_CLOSE_DAYS),
    };
    await tx.rooms.update(updated);
    await tx.audit.append({ roomId, memberId: null, actor: 'admin', action: 'room_closed', createdAt: now });
    return buildAdminView(deps, tx, updated);
  });
}

/** F-15: reopen; the result is removed, answers are kept. */
export async function reopenRoom(deps: Deps, roomId: string, cred: Credential): Promise<AdminViewResponse> {
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'admin', room, cred);
    if (room.status === 'open') throw conflict('すでに受付中です');

    const now = deps.clock.now();
    await tx.results.delete(roomId);
    const unclosedLimit = addDays(room.createdAt, RETENTION_UNCLOSED_DAYS);
    const minimum = addDays(now, RETENTION_AFTER_CLOSE_DAYS);
    const updated: Room = {
      ...room,
      status: 'open',
      purgeAfter: unclosedLimit > minimum ? unclosedLimit : minimum,
    };
    await tx.rooms.update(updated);
    await tx.audit.append({ roomId, memberId: null, actor: 'admin', action: 'room_reopened', createdAt: now });
    return buildAdminView(deps, tx, updated);
  });
}

/** §7.5: delete rooms past their purge date. */
export async function purgeExpiredRooms(deps: Deps): Promise<number> {
  return deps.uow.transaction((tx) => tx.rooms.deleteExpired(deps.clock.now()));
}
