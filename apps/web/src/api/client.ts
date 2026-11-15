import type {
  AddMemberResponse,
  AdminViewResponse,
  ClaimResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  ErrorCode,
  ErrorResponse,
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

type TokenHeader = { admin?: string; invite?: string; member?: string };

export class HttpApiClient implements ApiClient {
  constructor(private readonly baseUrl = '') {}

  private async request<T>(method: string, path: string, tokens: TokenHeader = {}, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (tokens.admin) headers[HEADERS.admin] = tokens.admin;
    if (tokens.invite) headers[HEADERS.invite] = tokens.invite;
    if (tokens.member) headers[HEADERS.member] = tokens.member;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
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
}

const enc = encodeURIComponent;
