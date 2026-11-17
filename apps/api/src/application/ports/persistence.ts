import type { Answer, AuditEvent, Event, Member, Result, Room } from '../../domain/types.js';

/**
 * Persistence ports. Every repository method is scoped by room where possible so
 * adapters never look up a member by id alone (spec §8.6-3).
 */

export interface RetentionCutoff {
  closedBefore: Date;
  createdBefore: Date;
}

export interface RoomRepository {
  insert(room: Room): Promise<void>;
  findById(id: string): Promise<Room | null>;
  update(room: Room): Promise<void>;
  /** Deletes a room and everything in it (members, answers, result, audit). */
  delete(id: string): Promise<void>;
  /** Communities of an event, in creation order. */
  listByEvent(eventId: string): Promise<Room[]>;
  /** Ids of open rooms whose automatic deadline has passed. */
  findOpenDue(now: Date): Promise<string[]>;
  /**
   * Deletes rooms past retention (members/answers/results/audit cascade):
   * closed rooms whose latest close is at or before `closedBefore`, and rooms not closed
   * that were created at or before `createdBefore` (and not closed after `closedBefore`).
   */
  deleteExpired(cutoff: RetentionCutoff): Promise<number>;
}

export interface EventRepository {
  /** Deletes an event and all its communities. */
  delete(id: string): Promise<void>;
  insert(event: Event): Promise<void>;
  findById(id: string): Promise<Event | null>;
  update(event: Event): Promise<void>;
  /**
   * Deletes events created at or before `createdBefore` (their rooms cascade), and events
   * without any community created at or before `closedBefore`.
   */
  deleteExpired(cutoff: RetentionCutoff): Promise<number>;
}

export interface MemberRepository {
  listByRoom(roomId: string): Promise<Member[]>;
  findInRoom(roomId: string, memberId: string): Promise<Member | null>;
  findByInviteTokenHash(hash: string): Promise<Member | null>;
  findByMemberTokenHash(hash: string): Promise<Member | null>;
  countByRoom(roomId: string): Promise<number>;
  insert(member: Member): Promise<void>;
  update(member: Member): Promise<void>;
  delete(roomId: string, memberId: string): Promise<void>;
  /**
   * Conditional update: succeeds only while invite_used_at is null.
   * Returns false if another request already claimed it.
   */
  claimInvite(roomId: string, memberId: string, memberTokenHash: string, usedAt: Date): Promise<boolean>;
}

export interface AnswerRepository {
  findByMember(memberId: string): Promise<Answer | null>;
  listByRoom(roomId: string): Promise<Answer[]>;
  upsert(answer: Answer): Promise<void>;
  delete(memberId: string): Promise<void>;
}

export interface ResultRepository {
  find(roomId: string): Promise<Result | null>;
  save(result: Result): Promise<void>;
  delete(roomId: string): Promise<void>;
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  /** Number of answer_saved events since the member's latest invite_claimed event. */
  countAnswerSavesSinceLastClaim(roomId: string, memberId: string): Promise<number>;
}

export interface DataCounts {
  events: number;
  rooms: number;
  openRooms: number;
  members: number;
  answers: number;
}

/** Operator-only maintenance (never reachable from HTTP). */
export interface OpsRepository {
  counts(): Promise<DataCounts>;
  /** Ids of standalone rooms / events whose title starts with `prefix`. */
  findByTitlePrefix(prefix: string): Promise<{ roomIds: string[]; eventIds: string[] }>;
  /** Deletes every event and room (and everything in them). */
  deleteAll(): Promise<{ events: number; rooms: number }>;
}

export interface Tx {
  ops: OpsRepository;
  events: EventRepository;
  rooms: RoomRepository;
  members: MemberRepository;
  answers: AnswerRepository;
  results: ResultRepository;
  audit: AuditRepository;
}

export interface UnitOfWork {
  /** Read-only access (no lock). */
  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** A transaction without a room lock (room creation, purge). */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * A transaction that first locks the room row (SELECT ... FOR UPDATE).
   * Concurrent operations on the same room are serialized.
   * Throws not_found if the room does not exist.
   */
  withRoomLock<T>(roomId: string, fn: (tx: Tx, room: Room) => Promise<T>): Promise<T>;
  /** Same as withRoomLock, for an event row (adding communities). */
  withEventLock<T>(eventId: string, fn: (tx: Tx, event: Event) => Promise<T>): Promise<T>;
}
