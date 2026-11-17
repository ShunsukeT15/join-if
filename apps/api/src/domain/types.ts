export type RoomStatus = 'open' | 'closed';
export type Choice = 'yes' | 'no' | 'cond';
export type InviteMode = 'individual' | 'group';

/** An organizer's event grouping several communities (rooms). Only the organizer sees it. */
export interface Event {
  id: string;
  title: string;
  message: string;
  adminTokenHash: string;
  createdAt: Date;
  purgeAfter: Date;
}

export interface Room {
  id: string;
  /** Set when the room is a community of an event; its admin token is the event's. */
  eventId: string | null;
  communityName: string | null;
  title: string;
  deadlineText: string;
  message: string;
  status: RoomStatus;
  inviteMode: InviteMode;
  adminTokenHash: string;
  /** group mode: SHA-256 of the shared group token, and the token encrypted for re-display. */
  groupTokenHash: string | null;
  groupTokenEnc: string | null;
  /** Automatic close time; answers are refused from this moment. */
  deadlineAt: Date | null;
  createdAt: Date;
  closedAt: Date | null;
  purgeAfter: Date;
}

export interface Member {
  id: string;
  roomId: string;
  displayName: string;
  /**
   * individual mode: SHA-256 of the current invite token (kept after use so a second claim yields 410).
   * group mode: null (members pick their name through the shared group URL).
   */
  inviteTokenHash: string | null;
  /** Encrypted invite token, only while unused (for re-display on the admin screen). */
  inviteTokenEnc: string | null;
  /** When the invite URL was opened (individual) or the name was picked (group). */
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
  | 'settings_changed'
  | 'group_token_reissued'
  | 'community_created';

export interface AuditEvent {
  roomId: string;
  memberId: string | null;
  actor: AuditActor;
  action: AuditAction;
  createdAt: Date;
}
