import { notFound } from '../domain/errors.js';
import type { Event, Member, Room } from '../domain/types.js';
import type { Tx } from './ports/persistence.js';
import type { TokenService } from './ports/services.js';

export type CredentialKind = 'admin' | 'invite' | 'member' | 'group';

/** A token presented by a client, tagged with the header it came from. */
export interface Credential {
  kind: CredentialKind;
  token: string | undefined;
}

export interface AdminAuth {
  kind: 'admin';
  room: Room;
}
export interface MemberAuth {
  kind: 'member';
  room: Room;
  member: Member;
}
export interface InviteAuth {
  kind: 'invite';
  room: Room;
  member: Member;
}
/** Holder of a group-mode room's shared URL (not yet a specific member). */
export interface GroupAuth {
  kind: 'group';
  room: Room;
}

type AuthFor<K extends CredentialKind> = K extends 'admin'
  ? AdminAuth
  : K extends 'member'
    ? MemberAuth
    : K extends 'group'
      ? GroupAuth
      : InviteAuth;

/**
 * The single authorization gate every use case passes through (spec §8.6).
 *
 * 1. The credential kind must be the one the operation requires.
 * 2. The token must belong to the room in the path.
 * Every failure is reported as not_found, indistinguishable from a missing room.
 */
export async function authorize<K extends CredentialKind>(
  tx: Tx,
  tokens: TokenService,
  required: K,
  room: Room,
  credential: Credential,
): Promise<AuthFor<K>> {
  if (credential.kind !== required) throw notFound();
  const token = credential.token;
  if (!token || token.length > 200) throw notFound();
  const hash = tokens.hash(token);

  switch (required) {
    case 'admin': {
      if (hash !== room.adminTokenHash) throw notFound();
      return { kind: 'admin', room } as AuthFor<K>;
    }
    case 'member': {
      const member = await tx.members.findByMemberTokenHash(hash);
      if (!member || member.roomId !== room.id) throw notFound();
      return { kind: 'member', room, member } as AuthFor<K>;
    }
    case 'group': {
      if (room.inviteMode !== 'group' || room.groupTokenHash === null || hash !== room.groupTokenHash) throw notFound();
      return { kind: 'group', room } as AuthFor<K>;
    }
    case 'invite': {
      const member = await tx.members.findByInviteTokenHash(hash);
      if (!member || member.roomId !== room.id) throw notFound();
      return { kind: 'invite', room, member } as AuthFor<K>;
    }
  }
  throw notFound();
}

/** Event admin: the event's admin token (the only credential accepted on event routes). */
export function authorizeEvent(tokens: TokenService, event: Event, credential: Credential): void {
  if (credential.kind !== 'admin') throw notFound();
  const token = credential.token;
  if (!token || token.length > 200) throw notFound();
  if (tokens.hash(token) !== event.adminTokenHash) throw notFound();
}
