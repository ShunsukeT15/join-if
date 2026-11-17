import type { Tx, UnitOfWork } from '../../../application/ports/persistence.js';
import { notFound } from '../../../domain/errors.js';
import type { Answer, AuditEvent, Event, Member, Result, Room } from '../../../domain/types.js';

interface State {
  events: Map<string, Event>;
  rooms: Map<string, Room>;
  members: Map<string, Member>;
  answers: Map<string, Answer>;
  results: Map<string, Result>;
  audit: (AuditEvent & { seq: number })[];
  seq: number;
}

const emptyState = (): State => ({
  events: new Map(),
  rooms: new Map(),
  members: new Map(),
  answers: new Map(),
  results: new Map(),
  audit: [],
  seq: 0,
});

const clone = <T>(v: T): T => structuredClone(v);

function makeTx(s: State): Tx {
  const deleteRoomCascade = (roomId: string) => {
    for (const m of [...s.members.values()]) {
      if (m.roomId === roomId) {
        s.answers.delete(m.id);
        s.members.delete(m.id);
      }
    }
    s.results.delete(roomId);
    s.audit = s.audit.filter((e) => e.roomId !== roomId);
    s.rooms.delete(roomId);
  };

  return {
    ops: {
      async counts() {
        const rooms = [...s.rooms.values()];
        return {
          events: s.events.size,
          rooms: rooms.length,
          openRooms: rooms.filter((r) => r.status === 'open').length,
          members: s.members.size,
          answers: s.answers.size,
        };
      },
      async findByTitlePrefix(prefix) {
        return {
          roomIds: [...s.rooms.values()].filter((r) => r.eventId === null && r.title.startsWith(prefix)).map((r) => r.id),
          eventIds: [...s.events.values()].filter((e) => e.title.startsWith(prefix)).map((e) => e.id),
        };
      },
      async deleteAll() {
        const result = { events: s.events.size, rooms: s.rooms.size };
        for (const id of [...s.rooms.keys()]) deleteRoomCascade(id);
        s.events.clear();
        return result;
      },
    },
    events: {
      async delete(id) {
        for (const r of [...s.rooms.values()]) if (r.eventId === id) deleteRoomCascade(r.id);
        s.events.delete(id);
      },
      async insert(event) {
        if (s.events.has(event.id)) throw new Error('duplicate event id');
        s.events.set(event.id, clone(event));
      },
      async findById(id) {
        const e = s.events.get(id);
        return e ? clone(e) : null;
      },
      async update(event) {
        if (!s.events.has(event.id)) throw notFound();
        s.events.set(event.id, clone(event));
      },
      async deleteExpired({ closedBefore, createdBefore }) {
        const hasRooms = (id: string) => [...s.rooms.values()].some((r) => r.eventId === id);
        const expired = [...s.events.values()].filter(
          (e) => e.createdAt <= createdBefore || (!hasRooms(e.id) && e.createdAt <= closedBefore),
        );
        for (const e of expired) {
          for (const r of [...s.rooms.values()]) if (r.eventId === e.id) deleteRoomCascade(r.id);
          s.events.delete(e.id);
        }
        return expired.length;
      },
    },
    rooms: {
      async delete(id) {
        deleteRoomCascade(id);
      },
      async listByEvent(eventId) {
        return [...s.rooms.values()]
          .filter((r) => r.eventId === eventId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
          .map(clone);
      },
      async insert(room) {
        if (s.rooms.has(room.id)) throw new Error('duplicate room id');
        if (room.eventId !== null && !s.events.has(room.eventId)) throw notFound();
        s.rooms.set(room.id, clone(room));
      },
      async findById(id) {
        const r = s.rooms.get(id);
        return r ? clone(r) : null;
      },
      async update(room) {
        if (!s.rooms.has(room.id)) throw notFound();
        s.rooms.set(room.id, clone(room));
      },
      async findOpenDue(now) {
        return [...s.rooms.values()]
          .filter((r) => r.status === 'open' && r.deadlineAt !== null && r.deadlineAt <= now)
          .map((r) => r.id);
      },
      async deleteExpired({ closedBefore, createdBefore }) {
        const expired = [...s.rooms.values()].filter((r) =>
          r.status === 'closed'
            ? r.closedAt !== null && r.closedAt <= closedBefore
            : r.createdAt <= createdBefore && (r.closedAt === null || r.closedAt <= closedBefore),
        );
        for (const r of expired) deleteRoomCascade(r.id);
        return expired.length;
      },
    },
    members: {
      async listByRoom(roomId) {
        return [...s.members.values()]
          .filter((m) => m.roomId === roomId)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async findInRoom(roomId, memberId) {
        const m = s.members.get(memberId);
        return m && m.roomId === roomId ? clone(m) : null;
      },
      async findByInviteTokenHash(hash) {
        for (const m of s.members.values()) if (m.inviteTokenHash !== null && m.inviteTokenHash === hash) return clone(m);
        return null;
      },
      async findByMemberTokenHash(hash) {
        for (const m of s.members.values()) if (m.memberTokenHash !== null && m.memberTokenHash === hash) return clone(m);
        return null;
      },
      async countByRoom(roomId) {
        let n = 0;
        for (const m of s.members.values()) if (m.roomId === roomId) n++;
        return n;
      },
      async insert(member) {
        if (!s.rooms.has(member.roomId)) throw notFound();
        s.members.set(member.id, clone(member));
      },
      async update(member) {
        const cur = s.members.get(member.id);
        if (!cur || cur.roomId !== member.roomId) throw notFound();
        s.members.set(member.id, clone(member));
      },
      async delete(roomId, memberId) {
        const cur = s.members.get(memberId);
        if (cur && cur.roomId === roomId) {
          s.answers.delete(memberId);
          s.members.delete(memberId);
        }
      },
      async claimInvite(roomId, memberId, memberTokenHash, usedAt) {
        const cur = s.members.get(memberId);
        if (!cur || cur.roomId !== roomId || cur.inviteUsedAt !== null) return false;
        s.members.set(memberId, { ...cur, memberTokenHash, inviteUsedAt: usedAt, inviteTokenEnc: null });
        return true;
      },
    },
    answers: {
      async findByMember(memberId) {
        const a = s.answers.get(memberId);
        return a ? clone(a) : null;
      },
      async listByRoom(roomId) {
        return [...s.answers.values()].filter((a) => s.members.get(a.memberId)?.roomId === roomId).map(clone);
      },
      async upsert(answer) {
        if (!s.members.has(answer.memberId)) throw notFound();
        s.answers.set(answer.memberId, clone(answer));
      },
      async delete(memberId) {
        s.answers.delete(memberId);
      },
    },
    results: {
      async find(roomId) {
        const r = s.results.get(roomId);
        return r ? clone(r) : null;
      },
      async save(result) {
        s.results.set(result.roomId, clone(result));
      },
      async delete(roomId) {
        s.results.delete(roomId);
      },
    },
    audit: {
      async append(event) {
        s.audit.push({ ...clone(event), seq: ++s.seq });
      },
      async countAnswerSavesSinceLastClaim(roomId, memberId) {
        const events = s.audit.filter((e) => e.roomId === roomId && e.memberId === memberId);
        let lastClaim = -1;
        for (const e of events) if (e.action === 'invite_claimed') lastClaim = e.seq;
        return events.filter((e) => e.action === 'answer_saved' && e.seq > lastClaim).length;
      },
    },
  };
}

/**
 * In-memory adapter for development and tests.
 * All operations run one at a time (a global mutex), and a failed transaction
 * is rolled back to the snapshot taken before it started.
 */
export class MemoryUnitOfWork implements UnitOfWork {
  private state: State = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.serialize(() => fn(makeTx(this.state)));
  }

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      const snapshot = clone(this.state);
      try {
        return await fn(makeTx(this.state));
      } catch (e) {
        this.state = snapshot;
        throw e;
      }
    });
  }

  withRoomLock<T>(roomId: string, fn: (tx: Tx, room: Room) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      const room = await tx.rooms.findById(roomId);
      if (!room) throw notFound();
      return fn(tx, room);
    });
  }

  withEventLock<T>(eventId: string, fn: (tx: Tx, event: Event) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      const event = await tx.events.findById(eventId);
      if (!event) throw notFound();
      return fn(tx, event);
    });
  }

  /** Test helper: a deep copy of the stored data. */
  dump(): State {
    return clone(this.state);
  }
}
