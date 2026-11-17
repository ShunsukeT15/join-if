import type {
  AddCommunityRequest,
  AddCommunityResponse,
  AddMemberResponse,
  CreateEventRequest,
  CreateEventResponse,
  EventAdminViewResponse,
  MetaResponse,
  UpdateEventRequest,
  AdminViewResponse,
  ClaimResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  ErrorCode,
  ErrorResponse,
  GroupTokenResponse,
  GroupViewResponse,
  MemberViewResponse,
  ReissueResponse,
  SaveAnswerRequest,
  UpdateSettingsRequest,
} from '@himitsu/contracts';
import { HEADERS } from '@himitsu/contracts';

/** The UI depends on this interface only; swap the implementation for tests or another backend. */
export interface ApiClient {
  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse>;
  getAdminView(roomId: string, adminToken: string): Promise<AdminViewResponse>;
  updateSettings(roomId: string, adminToken: string, req: UpdateSettingsRequest): Promise<AdminViewResponse>;
  addMember(roomId: string, adminToken: string, name: string): Promise<AddMemberResponse>;
  removeMember(roomId: string, adminToken: string, memberId: string): Promise<void>;
  reissueInvite(roomId: string, adminToken: string, memberId: string): Promise<ReissueResponse>;
  closeRoom(roomId: string, adminToken: string): Promise<AdminViewResponse>;
  reopenRoom(roomId: string, adminToken: string): Promise<AdminViewResponse>;
  claimInvite(roomId: string, inviteToken: string): Promise<ClaimResponse>;
  getMemberView(roomId: string, memberToken: string): Promise<MemberViewResponse>;
  saveAnswer(roomId: string, memberToken: string, req: SaveAnswerRequest): Promise<MemberViewResponse>;
  getGroupView(roomId: string, groupToken: string): Promise<GroupViewResponse>;
  claimName(roomId: string, groupToken: string, memberId: string): Promise<ClaimResponse>;
  reissueGroupToken(roomId: string, adminToken: string): Promise<GroupTokenResponse>;
  createEvent(req: CreateEventRequest): Promise<CreateEventResponse>;
  getEventAdminView(eventId: string, adminToken: string): Promise<EventAdminViewResponse>;
  updateEvent(eventId: string, adminToken: string, req: UpdateEventRequest): Promise<EventAdminViewResponse>;
  addCommunity(eventId: string, adminToken: string, req: AddCommunityRequest): Promise<AddCommunityResponse>;
  deleteRoom(roomId: string, adminToken: string): Promise<void>;
  deleteEvent(eventId: string, adminToken: string): Promise<void>;
  getMeta(): Promise<MetaResponse>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network',
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenHeader = { admin?: string; invite?: string; member?: string; group?: string };

export class HttpApiClient implements ApiClient {
  constructor(private readonly baseUrl = '') {}

  private async request<T>(method: string, path: string, tokens: TokenHeader = {}, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (tokens.admin) headers[HEADERS.admin] = tokens.admin;
    if (tokens.invite) headers[HEADERS.invite] = tokens.invite;
    if (tokens.member) headers[HEADERS.member] = tokens.member;
    if (tokens.group) headers[HEADERS.group] = tokens.group;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const payload = body === undefined ? undefined : JSON.stringify(body);
    // CloudFront signs requests to the Lambda origin (OAC); for requests with a body
    // the viewer must supply the payload hash.
    if (method !== 'GET' && method !== 'HEAD') headers['x-amz-content-sha256'] = await sha256Hex(payload ?? '');

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: payload,
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'network', '通信できませんでした。電波の良いところで再度お試しください');
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page from a proxy */
    }
    if (!res.ok) {
      const err = (json as ErrorResponse | null)?.error;
      throw new ApiError(
        res.status,
        err?.code ?? 'internal',
        err?.message ?? 'エラーが発生しました。時間をおいて再度お試しください',
        err?.fields ?? {},
      );
    }
    return json as T;
  }

  createRoom(req: CreateRoomRequest) {
    return this.request<CreateRoomResponse>('POST', '/api/rooms', {}, req);
  }
  getAdminView(roomId: string, admin: string) {
    return this.request<AdminViewResponse>('GET', `/api/rooms/${enc(roomId)}/admin`, { admin });
  }
  updateSettings(roomId: string, admin: string, req: UpdateSettingsRequest) {
    return this.request<AdminViewResponse>('PATCH', `/api/rooms/${enc(roomId)}/admin`, { admin }, req);
  }
  addMember(roomId: string, admin: string, name: string) {
    return this.request<AddMemberResponse>('POST', `/api/rooms/${enc(roomId)}/members`, { admin }, { name });
  }
  removeMember(roomId: string, admin: string, memberId: string) {
    return this.request<void>('DELETE', `/api/rooms/${enc(roomId)}/members/${enc(memberId)}`, { admin });
  }
  reissueInvite(roomId: string, admin: string, memberId: string) {
    return this.request<ReissueResponse>('POST', `/api/rooms/${enc(roomId)}/members/${enc(memberId)}/reissue`, { admin });
  }
  closeRoom(roomId: string, admin: string) {
    return this.request<AdminViewResponse>('POST', `/api/rooms/${enc(roomId)}/close`, { admin });
  }
  reopenRoom(roomId: string, admin: string) {
    return this.request<AdminViewResponse>('POST', `/api/rooms/${enc(roomId)}/reopen`, { admin });
  }
  claimInvite(roomId: string, invite: string) {
    return this.request<ClaimResponse>('POST', `/api/rooms/${enc(roomId)}/claim`, { invite });
  }
  getMemberView(roomId: string, member: string) {
    return this.request<MemberViewResponse>('GET', `/api/rooms/${enc(roomId)}/me`, { member });
  }
  saveAnswer(roomId: string, member: string, req: SaveAnswerRequest) {
    return this.request<MemberViewResponse>('PUT', `/api/rooms/${enc(roomId)}/me/answer`, { member }, req);
  }
  getGroupView(roomId: string, group: string) {
    return this.request<GroupViewResponse>('GET', `/api/rooms/${enc(roomId)}/group`, { group });
  }
  claimName(roomId: string, group: string, memberId: string) {
    return this.request<ClaimResponse>('POST', `/api/rooms/${enc(roomId)}/group/claim`, { group }, { memberId });
  }
  reissueGroupToken(roomId: string, admin: string) {
    return this.request<GroupTokenResponse>('POST', `/api/rooms/${enc(roomId)}/group/reissue`, { admin });
  }
  createEvent(req: CreateEventRequest) {
    return this.request<CreateEventResponse>('POST', '/api/events', {}, req);
  }
  getEventAdminView(eventId: string, admin: string) {
    return this.request<EventAdminViewResponse>('GET', `/api/events/${enc(eventId)}/admin`, { admin });
  }
  updateEvent(eventId: string, admin: string, req: UpdateEventRequest) {
    return this.request<EventAdminViewResponse>('PATCH', `/api/events/${enc(eventId)}/admin`, { admin }, req);
  }
  addCommunity(eventId: string, admin: string, req: AddCommunityRequest) {
    return this.request<AddCommunityResponse>('POST', `/api/events/${enc(eventId)}/communities`, { admin }, req);
  }
  deleteRoom(roomId: string, admin: string) {
    return this.request<void>('DELETE', `/api/rooms/${enc(roomId)}`, { admin });
  }
  deleteEvent(eventId: string, admin: string) {
    return this.request<void>('DELETE', `/api/events/${enc(eventId)}`, { admin });
  }
  getMeta() {
    return this.request<MetaResponse>('GET', '/api/meta');
  }
}

const enc = encodeURIComponent;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
