import type { Answer, AuditEvent, Member, Result, Room } from '../../domain/types.js';

/**
 * Persistence ports. Every repository method is scoped by room where possible so
 * adapters never look up a member by id alone (spec §8.6-3).
 */

export interface RoomRepository {
  insert(room: Room): Promise<void>;
  findById(id: string): Promise<Room | null>;
  update(room: Room): Promise<void>;
  /** Ids of open rooms whose automatic deadline has passed. */
  findOpenDue(now: Date): Promise<string[]>;
  /** Deletes rooms whose purgeAfter is past (members/answers/results/audit cascade). */
  deleteExpired(now: Date): Promise<number>;
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

export interface Tx {
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
}
