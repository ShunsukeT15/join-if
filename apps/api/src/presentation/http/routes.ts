import type { z } from 'zod';
import type { CredentialKind } from '../../application/authorize.js';
import * as A from '../../application/usecases/admin.js';
import * as E from '../../application/usecases/event.js';
import * as G from '../../application/usecases/group.js';
import * as M from '../../application/usecases/member.js';
import type { Credential } from '../../application/authorize.js';
import type { Deps } from '../../application/deps.js';
import {
  addCommunitySchema,
  addMemberSchema,
  createEventSchema,
  updateEventSchema,
  createRoomSchema,
  groupClaimSchema,
  saveAnswerSchema,
  updateSettingsSchema,
} from './schemas.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RateRule {
  /** What the counter is keyed by. */
  by: 'ip' | 'token';
  limit: number;
  windowMs: number;
  name: string;
}

export interface HandlerContext<B> {
  deps: Deps;
  params: { roomId: string; memberId: string; eventId: string };
  cred: Credential;
  body: B;
}

export interface RouteDef<S extends z.ZodType = z.ZodType> {
  method: Method;
  path: string;
  /** Required credential, or null for public endpoints. */
  auth: CredentialKind | null;
  body?: S;
  rate: RateRule[];
  /** HTTP status on success. */
  status: 200 | 201 | 204;
  handler: (ctx: HandlerContext<z.infer<S>>) => Promise<unknown>;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Spec §8.5 */
const tokenCheck: RateRule = { by: 'ip', limit: 60, windowMs: MIN, name: 'token' };
const createRoomRule: RateRule = { by: 'ip', limit: 10, windowMs: HOUR, name: 'create' };
const saveRule: RateRule = { by: 'token', limit: 10, windowMs: MIN, name: 'save' };

const def = <S extends z.ZodType>(r: RouteDef<S>): RouteDef => r as unknown as RouteDef;

/**
 * Every API endpoint (spec §8.1). Tests iterate over this table, so a newly
 * added route is automatically covered by the authorization tests.
 */
export const routes: RouteDef[] = [
  def({
    method: 'POST',
    path: '/api/rooms',
    auth: null,
    body: createRoomSchema,
    rate: [createRoomRule],
    status: 201,
    handler: ({ deps, body }) => A.createRoom(deps, body),
  }),
  def({
    method: 'GET',
    path: '/api/rooms/:roomId/admin',
    auth: 'admin',
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred }) => A.getAdminView(deps, params.roomId, cred),
  }),
  def({
    method: 'PATCH',
    path: '/api/rooms/:roomId/admin',
    auth: 'admin',
    body: updateSettingsSchema,
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred, body }) => A.updateSettings(deps, params.roomId, cred, body),
  }),
  def({
    method: 'POST',
    path: '/api/rooms/:roomId/members',
    auth: 'admin',
    body: addMemberSchema,
    rate: [tokenCheck],
    status: 201,
    handler: ({ deps, params, cred, body }) => A.addMember(deps, params.roomId, cred, body),
  }),
  def({
    method: 'DELETE',
    path: '/api/rooms/:roomId/members/:memberId',
    auth: 'admin',
    rate: [tokenCheck],
    status: 204,
    handler: ({ deps, params, cred }) => A.removeMember(deps, params.roomId, cred, params.memberId),
  }),
  def({
    method: 'POST',
    path: '/api/rooms/:roomId/members/:memberId/reissue',
    auth: 'admin',
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred }) => A.reissueInvite(deps, params.roomId, cred, params.memberId),
  }),
  def({
    method: 'POST',
    path: '/api/rooms/:roomId/close',
    auth: 'admin',
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred }) => A.closeRoom(deps, params.roomId, cred),
  }),
  def({
    method: 'POST',
    path: '/api/rooms/:roomId/reopen',
    auth: 'admin',
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred }) => A.reopenRoom(deps, params.roomId, cred),
  }),
  def({
    method: 'POST',
    path: '/api/rooms/:roomId/claim',
    auth: 'invite',
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred }) => M.claimInvite(deps, params.roomId, cred),
  }),
  def({
    method: 'GET',
    path: '/api/rooms/:roomId/me',
    auth: 'member',
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred }) => M.getMemberView(deps, params.roomId, cred),
  }),
  def({
    method: 'PUT',
    path: '/api/rooms/:roomId/me/answer',
    auth: 'member',
    body: saveAnswerSchema,
    rate: [tokenCheck, saveRule],
    status: 200,
    handler: ({ deps, params, cred, body }) => M.saveAnswer(deps, params.roomId, cred, body),
  }),
  def({
    method: 'POST',
    path: '/api/rooms/:roomId/group/reissue',
    auth: 'admin',
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred }) => A.reissueGroupToken(deps, params.roomId, cred),
  }),
  def({
    method: 'GET',
    path: '/api/rooms/:roomId/group',
    auth: 'group',
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred }) => G.getGroupView(deps, params.roomId, cred),
  }),
  def({
    method: 'POST',
    path: '/api/rooms/:roomId/group/claim',
    auth: 'group',
    body: groupClaimSchema,
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred, body }) => G.claimName(deps, params.roomId, cred, body),
  }),
  def({
    method: 'POST',
    path: '/api/events',
    auth: null,
    body: createEventSchema,
    rate: [createRoomRule],
    status: 201,
    handler: ({ deps, body }) => E.createEvent(deps, body),
  }),
  def({
    method: 'GET',
    path: '/api/events/:eventId/admin',
    auth: 'admin',
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred }) => E.getEventAdminView(deps, params.eventId, cred),
  }),
  def({
    method: 'PATCH',
    path: '/api/events/:eventId/admin',
    auth: 'admin',
    body: updateEventSchema,
    rate: [tokenCheck],
    status: 200,
    handler: ({ deps, params, cred, body }) => E.updateEvent(deps, params.eventId, cred, body),
  }),
  def({
    method: 'POST',
    path: '/api/events/:eventId/communities',
    auth: 'admin',
    body: addCommunitySchema,
    rate: [tokenCheck],
    status: 201,
    handler: ({ deps, params, cred, body }) => E.addCommunity(deps, params.eventId, cred, body),
  }),
];
