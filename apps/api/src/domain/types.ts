export type RoomStatus = 'open' | 'closed';
export type Choice = 'yes' | 'no' | 'cond';

export interface Room {
  id: string;
  title: string;
  deadlineText: string;
  message: string;
  status: RoomStatus;
  adminTokenHash: string;
  createdAt: Date;
  closedAt: Date | null;
  purgeAfter: Date;
}

export interface Member {
  id: string;
  roomId: string;
  displayName: string;
  /** SHA-256 of the current invite token. Kept after use so a second claim yields 410. */
  inviteTokenHash: string;
  /** Encrypted invite token, only while unused (for re-display on the admin screen). */
  inviteTokenEnc: string | null;
  inviteUsedAt: Date | null;
  /** SHA-256 of the member token; null until claimed. The raw token is never stored. */
  memberTokenHash: string | null;
  sortOrder: number;
  createdAt: Date;
}

/**
 * One condition pattern; both parts must hold (AND).
 * A conditional answer holds several patterns and is satisfied if ANY holds (OR).
 */
export interface Pattern {
  /** Member ids chosen in the person part (never includes self). */
  people: string[];
  /** N: at least N of `people` must attend. 0 = no person part. */
  need: number;
  /** M: at least M attendees other than self. 0 = no headcount part. */
  minTotal: number;
}

export interface Answer {
  memberId: string;
  choice: Choice;
  /** Non-empty only for "cond". */
  patterns: Pattern[];
  updatedAt: Date;
}

export interface Result {
  roomId: string;
  attending: string[];
  computedAt: Date;
}

export type AuditActor = 'admin' | 'member' | 'system';
export type AuditAction =
  | 'member_added'
  | 'member_removed'
  | 'invite_reissued'
  | 'invite_claimed'
  | 'answer_saved'
  | 'room_closed'
  | 'room_reopened'
  | 'settings_changed';

export interface AuditEvent {
  roomId: string;
  memberId: string | null;
  actor: AuditActor;
  action: AuditAction;
  createdAt: Date;
}
