import { LIMITS } from './constants.js';
import { validation } from './errors.js';

export interface RoomSettingsInput {
  title?: string | undefined;
  deadlineText?: string | undefined;
  message?: string | undefined;
}

/** Normalizes (trims) and validates room settings. Throws a validation error. */
export function normalizeSettings<T extends RoomSettingsInput>(input: T, opts: { requireTitle: boolean }): T {
  const fields: Record<string, string> = {};
  const out: RoomSettingsInput = {};

  if (input.title !== undefined || opts.requireTitle) {
    const title = (input.title ?? '').trim();
    if (!title) fields.title = 'イベント名を入力してください';
    else if ([...title].length > LIMITS.titleMax) fields.title = `${LIMITS.titleMax}文字以内で入力してください`;
    out.title = title;
  }
  if (input.deadlineText !== undefined) {
    const v = input.deadlineText.trim();
    if ([...v].length > LIMITS.deadlineTextMax) fields.deadlineText = `${LIMITS.deadlineTextMax}文字以内で入力してください`;
    out.deadlineText = v;
  }
  if (input.message !== undefined) {
    const v = input.message.trim();
    if ([...v].length > LIMITS.messageMax) fields.message = `${LIMITS.messageMax}文字以内で入力してください`;
    out.message = v;
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return out as T;
}

export function normalizeMemberName(name: string): string {
  const v = name.trim();
  if (!v) throw validation({ name: '名前を入力してください' });
  if ([...v].length > LIMITS.nameMax) throw validation({ name: `${LIMITS.nameMax}文字以内で入力してください` });
  return v;
}

export function normalizeCommunityName(name: string): string {
  const v = name.trim();
  if (!v) throw validation({ communityName: 'コミュニティ名を入力してください' });
  if ([...v].length > LIMITS.communityNameMax) {
    throw validation({ communityName: `${LIMITS.communityNameMax}文字以内で入力してください` });
  }
  return v;
}

const MAX_DEADLINE_DAYS = 365;

/**
 * Parses an automatic deadline. undefined = unchanged, null = no automatic deadline.
 * Must be a valid time in the future (at least 1 minute ahead) and within a year.
 */
export function normalizeDeadline(input: string | null | undefined, now: Date): Date | null | undefined {
  if (input === undefined || input === null) return input;
  const t = Date.parse(input);
  if (Number.isNaN(t)) throw validation({ deadlineAt: '日時の形式が正しくありません' });
  if (t < now.getTime() + 60_000) throw validation({ deadlineAt: '締切日時は今より後の時刻を指定してください' });
  if (t > now.getTime() + MAX_DEADLINE_DAYS * 24 * 60 * 60 * 1000) {
    throw validation({ deadlineAt: '締切日時は1年以内で指定してください' });
  }
  return new Date(t);
}

/** True once the automatic deadline has passed. */
export function isPastDeadline(room: { deadlineAt: Date | null }, now: Date): boolean {
  return room.deadlineAt !== null && room.deadlineAt.getTime() <= now.getTime();
}

/** Answers and member changes are accepted only while open and before the automatic deadline. */
export function acceptsChanges(room: { status: string; deadlineAt: Date | null }, now: Date): boolean {
  return room.status === 'open' && !isPastDeadline(room, now);
}
