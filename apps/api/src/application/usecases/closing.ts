import { addDays } from '../../domain/constants.js';
import { isPastDeadline } from '../../domain/roomRules.js';
import { solve, type SolverAnswer } from '../../domain/solver.js';
import type { AuditActor, Room } from '../../domain/types.js';
import type { Deps } from '../deps.js';
import type { Tx } from '../ports/persistence.js';

/**
 * Closes a room and computes the result on the server (spec §6, F-13/F-14).
 * Must run inside uow.withRoomLock for this room. Unanswered members count as absent.
 */
export async function closeInTx(deps: Deps, tx: Tx, room: Room, actor: AuditActor): Promise<Room> {
  const members = await tx.members.listByRoom(room.id);
  const answers = await tx.answers.listByRoom(room.id);
  const map = new Map<string, SolverAnswer>(answers.map((a) => [a.memberId, a]));
  const attending = solve(
    members.map((m) => m.id),
    map,
  );

  const now = deps.clock.now();
  await tx.results.save({ roomId: room.id, attending: [...attending], computedAt: now });
  const updated: Room = {
    ...room,
    status: 'closed',
    closedAt: now,
    // Informational: deletion is decided by the current retention policy at purge time.
    purgeAfter: addDays(now, deps.retention.afterCloseDays),
  };
  await tx.rooms.update(updated);
  await tx.audit.append({ roomId: room.id, memberId: null, actor, action: 'room_closed', createdAt: now });
  return updated;
}

/** Closes the room now if its automatic deadline has passed (called before showing a room). */
export async function ensureClosedIfDue(deps: Deps, roomId: string): Promise<void> {
  const room = await deps.uow.read((tx) => tx.rooms.findById(roomId));
  if (!room || room.status !== 'open' || !isPastDeadline(room, deps.clock.now())) return;
  await deps.uow.withRoomLock(roomId, async (tx, locked) => {
    // Re-check under the lock: another request may have closed it already.
    if (locked.status === 'open' && isPastDeadline(locked, deps.clock.now())) {
      await closeInTx(deps, tx, locked, 'system');
    }
  });
}

/** Scheduled job: closes every open room whose automatic deadline has passed. */
export async function closeDueRooms(deps: Deps): Promise<number> {
  const ids = await deps.uow.read((tx) => tx.rooms.findOpenDue(deps.clock.now()));
  let closed = 0;
  for (const id of ids) {
    try {
      await deps.uow.withRoomLock(id, async (tx, room) => {
        if (room.status === 'open' && isPastDeadline(room, deps.clock.now())) {
          await closeInTx(deps, tx, room, 'system');
          closed++;
        }
      });
    } catch (e) {
      // One failing room must not block the others; it is retried on the next run.
      console.error('[close-due] failed for a room:', e instanceof Error ? e.message : 'unknown');
    }
  }
  return closed;
}
