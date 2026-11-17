/**
 * API contract shared by the web client and the API server.
 * Only plain types live here so that neither side depends on the other's runtime.
 */

export type RoomStatus = 'open' | 'closed';
export type Choice = 'yes' | 'no' | 'cond';
/** individual: one-time invite URL per member / group: one shared URL, members pick their name. */
export type InviteMode = 'individual' | 'group';

export const LIMITS = {
  maxMembers: 100,
  titleMax: 100,
  deadlineTextMax: 50,
  messageMax: 500,
  nameMax: 50,
  /** Max OR-patterns in one conditional answer. */
  maxPatterns: 5,
  /** Max communities (rooms) in one event. */
  maxCommunities: 20,
  communityNameMax: 50,
} as const;

export const HEADERS = {
  admin: 'X-Admin-Token',
  invite: 'X-Invite-Token',
  member: 'X-Member-Token',
  group: 'X-Group-Token',
} as const;

export interface RoomInfo {
  title: string;
  deadlineText: string;
  message: string;
  status: RoomStatus;
  inviteMode: InviteMode;
  /** When set, answers stop at this time and the room closes automatically (ISO 8601). */
  deadlineAt: string | null;
  /** Set when the room is a community of an event (e.g. "大学の友人"). */
  communityName: string | null;
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
  /** individual mode only: present while the invite URL has not been used. */
  inviteToken?: string;
  /** individual: invite URL opened / group: name already picked. */
  inviteUsed: boolean;
}

/** What a holder of the group URL sees before picking a name. */
export interface GroupMember {
  id: string;
  name: string;
  /** Already picked by someone; cannot be picked again until the organizer resets it. */
  taken: boolean;
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
  inviteMode?: InviteMode;
  /** ISO 8601, in the future. null / omitted = close manually. */
  deadlineAt?: string | null;
}

export interface UpdateSettingsRequest {
  /** Standalone rooms only (an event's communities take the event title). */
  title?: string;
  /** Communities of an event only. */
  communityName?: string;
  deadlineText?: string;
  message?: string;
  /** ISO 8601 in the future, or null to remove the automatic deadline. */
  deadlineAt?: string | null;
}

export interface GroupClaimRequest {
  memberId: string;
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
  /** group mode only: the shared URL token. */
  groupToken?: string;
  /** Present when this room is a community of an event (admin view only). */
  event?: { id: string; title: string };
}

// ---- Events: several communities (rooms) under one organizer ----

export interface EventInfo {
  title: string;
  message: string;
}

export interface CommunitySummary {
  roomId: string;
  name: string;
  inviteMode: InviteMode;
  status: RoomStatus;
  deadlineAt: string | null;
  memberCount: number;
  answeredCount: number;
  /** Number of attendees once the community is closed; null while open. */
  attendingCount: number | null;
}

export interface EventAdminViewResponse {
  event: EventInfo;
  communities: CommunitySummary[];
  totals: {
    memberCount: number;
    answeredCount: number;
    /** Sum over closed communities. */
    attendingCount: number;
    closedCount: number;
  };
  /** Attendees of closed communities, in community order. */
  attendees: { name: string; community: string }[];
}

export interface CreateEventRequest {
  title: string;
  message?: string;
}

export interface CreateEventResponse {
  eventId: string;
  adminToken: string;
}

export interface UpdateEventRequest {
  title?: string;
  message?: string;
}

export interface AddCommunityRequest {
  name: string;
  inviteMode?: InviteMode;
  deadlineAt?: string | null;
  message?: string;
}

export interface AddCommunityResponse {
  roomId: string;
}

export interface GroupViewResponse {
  room: RoomInfo;
  members: GroupMember[];
}

export interface GroupTokenResponse {
  groupToken: string;
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
