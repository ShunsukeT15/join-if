import type { MetaResponse } from '@himitsu/contracts';
import { authorize, authorizeEvent, type Credential } from '../authorize.js';
import type { Deps } from '../deps.js';
import { notFound } from '../../domain/errors.js';

/**
 * Organizer-initiated deletion. Everything in the room (members, answers, result, audit)
 * is removed immediately and every URL of the room stops working. Not reversible.
 */
export async function deleteRoom(deps: Deps, roomId: string, cred: Credential): Promise<void> {
  await deps.uow.withRoomLock(roomId, async (tx, room) => {
    await authorize(tx, deps.tokens, 'admin', room, cred);
    await tx.rooms.delete(room.id);
  });
}

/** Deletes an event and all its communities. */
export async function deleteEvent(deps: Deps, eventId: string, cred: Credential): Promise<void> {
  await deps.uow.withEventLock(eventId, async (tx, event) => {
    authorizeEvent(deps.tokens, event, cred);
    await tx.events.delete(event.id);
  });
}

/** Public settings for the terms / privacy pages. */
export function getMeta(deps: Deps): MetaResponse {
  return { retention: { ...deps.retention } };
}

// ---- Operator-only maintenance (invoked via AWS Lambda with IAM, never over HTTP) ----

/** Title prefix used by the smoke test (and for test data in general). */
export const TEST_DATA_PREFIX = '[smoke]';
/** Phrase required to delete all data. */
export const RESET_CONFIRMATION = 'DELETE ALL DATA';

export async function opsStats(deps: Deps) {
  return deps.uow.read((tx) => tx.ops.counts());
}

/** Deletes standalone rooms and events whose title starts with the prefix. */
export async function opsDeleteTestData(deps: Deps, prefix = TEST_DATA_PREFIX) {
  if (!prefix.trim()) throw notFound();
  return deps.uow.transaction(async (tx) => {
    const { roomIds, eventIds } = await tx.ops.findByTitlePrefix(prefix);
    for (const id of roomIds) await tx.rooms.delete(id);
    for (const id of eventIds) await tx.events.delete(id);
    return { deletedRooms: roomIds.length, deletedEvents: eventIds.length };
  });
}

export async function opsDeleteRoom(deps: Deps, roomId: string) {
  return deps.uow.transaction(async (tx) => {
    const room = await tx.rooms.findById(roomId);
    if (!room) return { deleted: false };
    await tx.rooms.delete(roomId);
    return { deleted: true, title: room.title, communityName: room.communityName };
  });
}

export async function opsDeleteEvent(deps: Deps, eventId: string) {
  return deps.uow.transaction(async (tx) => {
    const event = await tx.events.findById(eventId);
    if (!event) return { deleted: false };
    const communities = (await tx.rooms.listByEvent(eventId)).length;
    await tx.events.delete(eventId);
    return { deleted: true, title: event.title, communities };
  });
}

/** Deletes every room and event. Requires the exact confirmation phrase. */
export async function opsResetAll(deps: Deps, confirm: string | undefined) {
  if (confirm !== RESET_CONFIRMATION) {
    throw new Error(`confirmation phrase required: "${RESET_CONFIRMATION}"`);
  }
  return deps.uow.transaction(async (tx) => {
    const before = await tx.ops.counts();
    await tx.ops.deleteAll();
    return { deleted: before };
  });
}
