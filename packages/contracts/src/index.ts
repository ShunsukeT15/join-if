/**
 * API contract shared by the web client and the API server.
 * Only plain types live here so that neither side depends on the other's runtime.
 */

export type RoomStatus = 'open' | 'closed';
export type Choice = 'yes' | 'no' | 'cond';

export const LIMITS = {
  maxMembers: 100,
  titleMax: 100,
  deadlineTextMax: 50,
  messageMax: 500,
  nameMax: 50,
  /** Max OR-patterns in one conditional answer. */
  maxPatterns: 5,
} as const;

export const HEADERS = {
  admin: 'X-Admin-Token',
  invite: 'X-Invite-Token',
  member: 'X-Member-Token',
} as const;

export interface RoomInfo {
  title: string;
  deadlineText: string;
  message: string;
  status: RoomStatus;
}

export interface ResultDto {
  attending: string[];
  computedAt: string;
}

export interface MemberSummary {
  id: string;
  name: string;
  answered: boolean;
}

export interface AdminMember extends MemberSummary {
  /** Present only while the invite URL has not been used. */
  inviteToken?: string;
  inviteUsed: boolean;
}

/**
 * One condition pattern. Inside a pattern both parts must hold (AND):
 * - at least `need` of `people` attend (need = 0 → no person part)
 * - at least `minTotal` attendees other than me (0 → no headcount part)
 */
export interface PatternDto {
  people: string[];
  need: number;
  minTotal: number;
}

export interface AnswerDto {
  choice: Choice;
  /** For "cond": attend if ANY pattern holds (OR). Empty for "yes" / "no". */
  patterns: PatternDto[];
  updatedAt: string;
}

export interface MeDto {
  id: string;
  answer: AnswerDto | null;
  saveCount: number;
  claimedAt: string | null;
  conditionNotice: boolean;
}

// ---- Requests ----

export interface CreateRoomRequest {
  title: string;
  deadlineText?: string;
  message?: string;
}

export interface UpdateSettingsRequest {
  title?: string;
  deadlineText?: string;
  message?: string;
}

export interface AddMemberRequest {
  name: string;
}

export interface SaveAnswerRequest {
  choice: Choice;
  /** Required (1..maxPatterns) when choice is "cond"; ignored otherwise. */
  patterns?: PatternDto[];
}

// ---- Responses ----

export interface CreateRoomResponse {
  roomId: string;
  adminToken: string;
}

export interface AdminViewResponse {
  room: RoomInfo;
  members: AdminMember[];
  unansweredCount: number;
  result: ResultDto | null;
}

export interface AddMemberResponse {
  member: AdminMember;
}

export interface ReissueResponse {
  member: AdminMember;
}

export interface ClaimResponse {
  memberToken: string;
}

export interface MemberViewResponse {
  room: RoomInfo;
  members: MemberSummary[];
  me: MeDto;
  result: ResultDto | null;
}

export type ErrorCode =
  | 'not_found'
  | 'invite_used'
  | 'closed'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'internal';

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    /** Field-level messages for validation errors. */
    fields?: Record<string, string>;
  };
}
