import type {
  AddCommunityRequest,
  AddCommunityResponse,
  CommunitySummary,
  CreateEventRequest,
  CreateEventResponse,
  EventAdminViewResponse,
  UpdateEventRequest,
} from '@himitsu/contracts';
import { addDays, LIMITS, RETENTION_UNCLOSED_DAYS } from '../../domain/constants.js';
import { notFound, validation } from '../../domain/errors.js';
import { normalizeCommunityName, normalizeSettings } from '../../domain/roomRules.js';
import type { Event } from '../../domain/types.js';
import { authorizeEvent, type Credential } from '../authorize.js';
import type { Deps } from '../deps.js';
import type { Tx } from '../ports/persistence.js';
import { insertNewRoom } from './admin.js';
import { ensureClosedIfDue } from './closing.js';

/**
 * Events group several communities (rooms) under one organizer. Each community keeps its
 * own invitation, deadline, close and result; members only ever see their own community.
 * The event's admin token is also every community's admin token.
 */

export async function createEvent(deps: Deps, input: CreateEventRequest): Promise<CreateEventResponse> {
  const s = normalizeSettings({ title: input.title, message: input.message ?? '' }, { requireTitle: true });
  const adminToken = deps.tokens.generate();
  const now = deps.clock.now();
  return deps.uow.transaction(async (tx) => {
    let id = deps.ids.roomId();
    for (let i = 0; i < 5 && (await tx.events.findById(id)); i++) id = deps.ids.roomId();
    await tx.events.insert({
      id,
      title: s.title!,
      message: s.message!,
      adminTokenHash: deps.tokens.hash(adminToken),
      createdAt: now,
      purgeAfter: addDays(now, RETENTION_UNCLOSED_DAYS),
    });
    return { eventId: id, adminToken };
  });
}

async function loadEvent(tx: Tx, eventId: string): Promise<Event> {
  const event = await tx.events.findById(eventId);
  if (!event) throw notFound();
  return event;
}

/** Organizer's overview: per-community progress and the event totals. */
export async function getEventAdminView(deps: Deps, eventId: string, cred: Credential): Promise<EventAdminViewResponse> {
  // Authorize first, then close communities whose automatic deadline has passed.
  const roomIds = await deps.uow.read(async (tx) => {
    authorizeEvent(deps.tokens, await loadEvent(tx, eventId), cred);
    return (await tx.rooms.listByEvent(eventId)).map((r) => r.id);
  });
  for (const id of roomIds) await ensureClosedIfDue(deps, id);

  return deps.uow.read(async (tx) => {
    const event = await loadEvent(tx, eventId);
    authorizeEvent(deps.tokens, event, cred);
    const rooms = await tx.rooms.listByEvent(eventId);
    const communities: CommunitySummary[] = [];
    const attendees: { name: string; community: string }[] = [];

    for (const room of rooms) {
      const members = await tx.members.listByRoom(room.id);
      const answered = new Set((await tx.answers.listByRoom(room.id)).map((a) => a.memberId));
      const result = room.status === 'closed' ? await tx.results.find(room.id) : null;
      const attending = result ? new Set(result.attending) : null;
      const name = room.communityName ?? room.title;
      communities.push({
        roomId: room.id,
        name,
        inviteMode: room.inviteMode,
        status: room.status,
        deadlineAt: room.deadlineAt ? room.deadlineAt.toISOString() : null,
        memberCount: members.length,
        answeredCount: members.filter((m) => answered.has(m.id)).length,
        attendingCount: attending ? members.filter((m) => attending.has(m.id)).length : null,
      });
      if (attending) {
        for (const m of members) if (attending.has(m.id)) attendees.push({ name: m.displayName, community: name });
      }
    }

    return {
      event: { title: event.title, message: event.message },
      communities,
      totals: {
        memberCount: communities.reduce((n, c) => n + c.memberCount, 0),
        answeredCount: communities.reduce((n, c) => n + c.answeredCount, 0),
        attendingCount: communities.reduce((n, c) => n + (c.attendingCount ?? 0), 0),
        closedCount: communities.filter((c) => c.status === 'closed').length,
      },
      attendees,
    };
  });
}

/** Event title/message. The title is copied to every community (what members see). */
export async function updateEvent(
  deps: Deps,
  eventId: string,
  cred: Credential,
  input: UpdateEventRequest,
): Promise<EventAdminViewResponse> {
  const patch = normalizeSettings(input, { requireTitle: false });
  await deps.uow.withEventLock(eventId, async (tx, event) => {
    authorizeEvent(deps.tokens, event, cred);
    await tx.events.update({ ...event, ...patch });
    if (patch.title !== undefined) {
      for (const room of await tx.rooms.listByEvent(eventId)) {
        await tx.rooms.update({ ...room, title: patch.title });
      }
    }
  });
  return getEventAdminView(deps, eventId, cred);
}

/** Adds a community. It starts as an open room using the event's title and admin token. */
export async function addCommunity(
  deps: Deps,
  eventId: string,
  cred: Credential,
  input: AddCommunityRequest,
): Promise<AddCommunityResponse> {
  const communityName = normalizeCommunityName(input.name);
  return deps.uow.withEventLock(eventId, async (tx, event) => {
    authorizeEvent(deps.tokens, event, cred);
    const existing = await tx.rooms.listByEvent(eventId);
    if (existing.length >= LIMITS.maxCommunities) {
      throw validation({ name: `コミュニティは${LIMITS.maxCommunities}個までです` }, `コミュニティは${LIMITS.maxCommunities}個までです`);
    }
    if (existing.some((r) => r.communityName === communityName)) {
      throw validation({ name: '同じ名前のコミュニティがあります' });
    }
    const roomId = await insertNewRoom(deps, tx, {
      title: event.title,
      message: input.message ?? event.message,
      inviteMode: input.inviteMode,
      deadlineAt: input.deadlineAt,
      adminTokenHash: event.adminTokenHash,
      eventId,
      communityName,
    });
    await tx.audit.append({ roomId, memberId: null, actor: 'admin', action: 'community_created', createdAt: deps.clock.now() });
    return { roomId };
  });
}
