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
