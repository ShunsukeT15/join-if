import type { Choice, Condition } from './types.js';

export interface AnswerInput {
  choice: Choice;
  condPeople?: string[] | undefined;
  condNeed?: number | undefined;
  condMinTotal?: number | undefined;
}

export interface NormalizedAnswer extends Condition {
  choice: Choice;
}

export type AnswerValidation =
  | { ok: true; value: NormalizedAnswer }
  | { ok: false; fields: Record<string, string> };

/**
 * Validates an answer against the room's current members (spec §5.4, §7.3).
 * For "yes"/"no" the condition is discarded.
 */
export function validateAnswer(
  input: AnswerInput,
  ctx: { selfId: string; memberIds: readonly string[] },
): AnswerValidation {
  if (input.choice !== 'cond') {
    return { ok: true, value: { choice: input.choice, condPeople: [], condNeed: 0, condMinTotal: 0 } };
  }

  const fields: Record<string, string> = {};
  const people = input.condPeople ?? [];
  const need = input.condNeed ?? 0;
  const minTotal = input.condMinTotal ?? 0;
  const roomMembers = new Set(ctx.memberIds);

  if (new Set(people).size !== people.length) {
    fields.condPeople = '同じ人が重複しています';
  } else if (people.includes(ctx.selfId)) {
    fields.condPeople = '自分自身は選べません';
  } else if (people.some((p) => !roomMembers.has(p))) {
    fields.condPeople = 'このルームのメンバーではない人が含まれています';
  }

  if (people.length === 0) {
    if (need !== 0) fields.condNeed = '人物条件の人数は、人を選んでから指定してください';
  } else if (!Number.isInteger(need) || need < 1 || need > people.length) {
    fields.condNeed = `1〜${people.length}人の範囲で指定してください`;
  }

  const maxTotal = Math.max(0, ctx.memberIds.length - 1);
  if (!Number.isInteger(minTotal) || minTotal < 0 || minTotal > maxTotal) {
    fields.condMinTotal = `0〜${maxTotal}人の範囲で指定してください`;
  }

  if (Object.keys(fields).length === 0 && need < 1 && minTotal < 1) {
    fields.choice = '条件付きの場合は、人物条件か人数条件の少なくとも一方を指定してください';
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { choice: 'cond', condPeople: [...people], condNeed: need, condMinTotal: minTotal } };
}

/** True when the answer's person condition references someone no longer in the room (spec §5.5). */
export function hasStaleCondition(cond: Condition, memberIds: readonly string[]): boolean {
  const set = new Set(memberIds);
  return cond.condPeople.some((p) => !set.has(p));
}
