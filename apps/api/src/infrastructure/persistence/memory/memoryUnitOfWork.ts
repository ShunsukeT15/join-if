import type { Tx, UnitOfWork } from '../../../application/ports/persistence.js';
import { notFound } from '../../../domain/errors.js';
import type { Answer, AuditEvent, Member, Result, Room } from '../../../domain/types.js';

interface State {
  rooms: Map<string, Room>;
  members: Map<string, Member>;
  answers: Map<string, Answer>;
  results: Map<string, Result>;
  audit: (AuditEvent & { seq: number })[];
  seq: number;
}

const emptyState = (): State => ({
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
    rooms: {
      async insert(room) {
        if (s.rooms.has(room.id)) throw new Error('duplicate room id');
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
      async deleteExpired(now) {
        const expired = [...s.rooms.values()].filter((r) => r.purgeAfter <= now);
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

  /** Test helper: a deep copy of the stored data. */
  dump(): State {
    return clone(this.state);
  }
}
