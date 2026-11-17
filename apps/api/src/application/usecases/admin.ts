import type {
  AddMemberResponse,
  AdminViewResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  GroupTokenResponse,
  ReissueResponse,
  UpdateSettingsRequest,
} from '@himitsu/contracts';
import { addDays, LIMITS } from '../../domain/constants.js';
import { conflict, notFound, roomClosed, validation } from '../../domain/errors.js';
import {
  acceptsChanges,
  isPastDeadline,
  normalizeCommunityName,
  normalizeDeadline,
  normalizeMemberName,
  normalizeSettings,
} from '../../domain/roomRules.js';
import type { InviteMode, Member, Room } from '../../domain/types.js';
import { closeInTx, ensureClosedIfDue } from './closing.js';
import { authorize, type Credential } from '../authorize.js';
import type { Deps } from '../deps.js';
import type { Tx } from '../ports/persistence.js';
import { adminMember, resultView, roomInfo } from '../views.js';

/** F-01: create a standalone room and issue the admin token. */
export async function createRoom(deps: Deps, input: CreateRoomRequest): Promise<CreateRoomResponse> {
  const adminToken = deps.tokens.generate();
  const roomId = await deps.uow.transaction((tx) =>
    insertNewRoom(deps, tx, {
      title: input.title,
      deadlineText: input.deadlineText,
      message: input.message,
      inviteMode: input.inviteMode,
      deadlineAt: input.deadlineAt,
      adminTokenHash: deps.tokens.hash(adminToken),
      eventId: null,
      communityName: null,
    }),
  );
  return { roomId, adminToken };
}

export interface NewRoomInput {
  title: string;
  deadlineText?: string | undefined;
  message?: string | undefined;
  inviteMode?: InviteMode | undefined;
  deadlineAt?: string | null | undefined;
  adminTokenHash: string;
  eventId: string | null;
  communityName: string | null;
  /** Defaults to now. Communities pass a strictly increasing time to keep a stable order. */
  createdAt?: Date | undefined;
}

/** Validates and inserts a room (standalone, or a community of an event). Returns its id. */
export async function insertNewRoom(deps: Deps, tx: Tx, input: NewRoomInput): Promise<string> {
  const settings = normalizeSettings(
    { title: input.title, deadlineText: input.deadlineText ?? '', message: input.message ?? '' },
    { requireTitle: true },
  );
  const now = deps.clock.now();
  const createdAt = input.createdAt ?? now;
  const deadlineAt = normalizeDeadline(input.deadlineAt, now) ?? null;
  const inviteMode = input.inviteMode ?? 'individual';
  const groupToken = inviteMode === 'group' ? deps.tokens.generate() : null;

  let id = deps.ids.roomId();
  for (let i = 0; i < 5 && (await tx.rooms.findById(id)); i++) id = deps.ids.roomId();
  const room: Room = {
    id,
    eventId: input.eventId,
    communityName: input.communityName,
    title: settings.title!,
    deadlineText: settings.deadlineText!,
    message: settings.message!,
    status: 'open',
    inviteMode,
    adminTokenHash: input.adminTokenHash,
    groupTokenHash: groupToken ? deps.tokens.hash(groupToken) : null,
    groupTokenEnc: groupToken ? deps.tokens.encrypt(groupToken) : null,
    deadlineAt,
    createdAt,
    closedAt: null,
    purgeAfter: addDays(now, deps.retention.unclosedDays),
  };
  await tx.rooms.insert(room);
  return id;
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
    ...(room.inviteMode === 'group' && room.groupTokenEnc ? { groupToken: deps.tokens.decrypt(room.groupTokenEnc) } : {}),
    ...(await eventRef(tx, room)),
  };
}

async function eventRef(tx: Tx, room: Room): Promise<{ event?: { id: string; title: string } }> {
  if (!room.eventId) return {};
  const event = await tx.events.findById(room.eventId);
  return event ? { event: { id: event.id, title: event.title } } : {};
}

/** GET admin view: statuses only, never answer contents. */
export async function getAdminView(deps: Deps, roomId: string, cred: Credential): Promise<AdminViewResponse> {
  await ensureClosedIfDue(deps, roomId);
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
  const { deadlineAt: rawDeadline, communityName: rawCommunity, ...texts } = input;
  const patch = normalizeSettings(texts, { requireTitle: false });
  const deadlineAt = normalizeDeadline(rawDeadline, deps.clock.now());
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'admin', room, cred);
    // A community takes its title from the event; it has a community name instead.
    if (room.eventId !== null && patch.title !== undefined) {
      throw validation({ title: 'イベント名はイベントの管理画面で変更してください' });
    }
    if (room.eventId === null && rawCommunity !== undefined) {
      throw validation({ communityName: 'コミュニティ名はイベントのコミュニティでのみ設定できます' });
    }
    const communityName = rawCommunity !== undefined ? normalizeCommunityName(rawCommunity) : room.communityName;
    const updated: Room = { ...room, ...patch, communityName, ...(deadlineAt !== undefined ? { deadlineAt } : {}) };
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
    if (!acceptsChanges(room, deps.clock.now())) throw roomClosed();

    const members = await tx.members.listByRoom(roomId);
    if (members.length >= LIMITS.maxMembers) {
      throw validation({ name: `メンバーは${LIMITS.maxMembers}人までです` }, `メンバーは${LIMITS.maxMembers}人までです`);
    }
    if (members.some((m) => m.displayName === name)) {
      throw validation({ name: '同じ名前のメンバーがいます' });
    }

    // Group mode: no per-member invite URL; the member picks the name via the group URL.
    const inviteToken = room.inviteMode === 'individual' ? deps.tokens.generate() : null;
    const now = deps.clock.now();
    const member: Member = {
      id: deps.ids.memberId(),
      roomId,
      displayName: name,
      inviteTokenHash: inviteToken ? deps.tokens.hash(inviteToken) : null,
      inviteTokenEnc: inviteToken ? deps.tokens.encrypt(inviteToken) : null,
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
    if (!acceptsChanges(room, deps.clock.now())) throw roomClosed();
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

/**
 * F-05 / §5.6: individual mode — new invite URL; old invite + member URL become invalid.
 * group mode — "reset": the name can be picked again; the old member URL becomes invalid.
 * Either way the answer is deleted.
 */
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
    if (!acceptsChanges(room, deps.clock.now())) throw roomClosed();

    const inviteToken = room.inviteMode === 'individual' ? deps.tokens.generate() : null;
    const updated: Member = {
      ...member,
      inviteTokenHash: inviteToken ? deps.tokens.hash(inviteToken) : null,
      inviteTokenEnc: inviteToken ? deps.tokens.encrypt(inviteToken) : null,
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
    const updated = await closeInTx(deps, tx, room, 'admin');
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
    const unclosedLimit = addDays(room.createdAt, deps.retention.unclosedDays);
    const minimum = addDays(now, deps.retention.afterCloseDays);
    const updated: Room = {
      ...room,
      status: 'open',
      purgeAfter: unclosedLimit > minimum ? unclosedLimit : minimum,
      // A deadline already in the past would close the room again immediately.
      deadlineAt: isPastDeadline(room, now) ? null : room.deadlineAt,
    };
    await tx.rooms.update(updated);
    await tx.audit.append({ roomId, memberId: null, actor: 'admin', action: 'room_reopened', createdAt: now });
    return buildAdminView(deps, tx, updated);
  });
}

/**
 * §7.5: delete data past the retention policy. The policy is applied at purge time, so a
 * changed retention period also applies to existing rooms.
 */
export async function purgeExpiredRooms(deps: Deps): Promise<number> {
  return deps.uow.transaction(async (tx) => {
    const now = deps.clock.now();
    const cutoff = {
      closedBefore: addDays(now, -deps.retention.afterCloseDays),
      createdBefore: addDays(now, -deps.retention.unclosedDays),
    };
    const rooms = await tx.rooms.deleteExpired(cutoff);
    await tx.events.deleteExpired(cutoff);
    return rooms;
  });
}

/** group mode: a new shared URL (e.g. it leaked). Members who already picked their name keep their URLs. */
export async function reissueGroupToken(deps: Deps, roomId: string, cred: Credential): Promise<GroupTokenResponse> {
  return deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'admin', room, cred);
    if (room.inviteMode !== 'group') throw notFound();
    const groupToken = deps.tokens.generate();
    await tx.rooms.update({
      ...room,
      groupTokenHash: deps.tokens.hash(groupToken),
      groupTokenEnc: deps.tokens.encrypt(groupToken),
    });
    await tx.audit.append({
      roomId,
      memberId: null,
      actor: 'admin',
      action: 'group_token_reissued',
      createdAt: deps.clock.now(),
    });
    return { groupToken };
  });
}
