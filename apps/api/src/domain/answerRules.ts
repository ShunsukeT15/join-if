import { LIMITS } from './constants.js';
import type { Choice, Pattern } from './types.js';

export interface PatternInput {
  people?: string[] | undefined;
  need?: number | undefined;
  minTotal?: number | undefined;
}

export interface AnswerInput {
  choice: Choice;
  patterns?: PatternInput[] | undefined;
}

export interface NormalizedAnswer {
  choice: Choice;
  patterns: Pattern[];
}

export type AnswerValidation =
  | { ok: true; value: NormalizedAnswer }
  | { ok: false; fields: Record<string, string> };

/**
 * Validates an answer against the room's current members (spec §5.4, §7.3).
 * For "yes"/"no" the patterns are discarded. For "cond", 1..maxPatterns patterns are
 * required, each with a person part and/or a headcount part.
 * Field keys: `patterns`, `patterns.<i>.people`, `patterns.<i>.need`, `patterns.<i>.minTotal`, `patterns.<i>`.
 */
export function validateAnswer(
  input: AnswerInput,
  ctx: { selfId: string; memberIds: readonly string[] },
): AnswerValidation {
  if (input.choice !== 'cond') {
    return { ok: true, value: { choice: input.choice, patterns: [] } };
  }

  const fields: Record<string, string> = {};
  const raw = input.patterns ?? [];
  if (raw.length === 0) {
    return { ok: false, fields: { patterns: '条件を1つ以上設定してください' } };
  }
  if (raw.length > LIMITS.maxPatterns) {
    return { ok: false, fields: { patterns: `条件は${LIMITS.maxPatterns}個までです` } };
  }

  const roomMembers = new Set(ctx.memberIds);
  const maxTotal = Math.max(0, ctx.memberIds.length - 1);
  const patterns: Pattern[] = [];

  raw.forEach((p, i) => {
    const key = `patterns.${i}`;
    const people = p.people ?? [];
    const need = p.need ?? 0;
    const minTotal = p.minTotal ?? 0;

    if (new Set(people).size !== people.length) {
      fields[`${key}.people`] = '同じ人が重複しています';
    } else if (people.includes(ctx.selfId)) {
      fields[`${key}.people`] = '自分自身は選べません';
    } else if (people.some((id) => !roomMembers.has(id))) {
      fields[`${key}.people`] = 'このルームのメンバーではない人が含まれています';
    }

    if (people.length === 0) {
      if (need !== 0) fields[`${key}.need`] = '人数は、人を選んでから指定してください';
    } else if (!Number.isInteger(need) || need < 1 || need > people.length) {
      fields[`${key}.need`] = `1〜${people.length}人の範囲で指定してください`;
    }

    if (!Number.isInteger(minTotal) || minTotal < 0 || minTotal > maxTotal) {
      fields[`${key}.minTotal`] = `0〜${maxTotal}人の範囲で指定してください`;
    }

    const own = Object.keys(fields).some((k) => k.startsWith(`${key}.`));
    if (!own && need < 1 && minTotal < 1) {
      fields[key] = '人物か人数の少なくとも一方を指定してください';
    }
    patterns.push({ people: [...people], need, minTotal });
  });

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { choice: 'cond', patterns } };
}

/** True when any pattern references someone no longer in the room (spec §5.5). */
export function hasStaleCondition(patterns: readonly Pattern[], memberIds: readonly string[]): boolean {
  const set = new Set(memberIds);
  return patterns.some((p) => p.people.some((id) => !set.has(id)));
}
