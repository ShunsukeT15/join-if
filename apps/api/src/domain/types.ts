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

export interface Condition {
  /** Member ids chosen in the person condition (never includes self). */
  condPeople: string[];
  /** N: at least N of condPeople must attend. 0 = no person condition. */
  condNeed: number;
  /** M: at least M attendees other than self. 0 = no headcount condition. */
  condMinTotal: number;
}

export interface Answer extends Condition {
  memberId: string;
  choice: Choice;
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
