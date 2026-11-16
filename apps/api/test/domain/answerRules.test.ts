import { describe, expect, it } from 'vitest';
import { hasStaleCondition, validateAnswer } from '../../src/domain/answerRules.js';

const ctx = { selfId: 'me', memberIds: ['me', 'a', 'b', 'c'] };
const p = (people: string[], need: number, minTotal = 0) => ({ people, need, minTotal });

describe('validateAnswer', () => {
  it('yes/no discard patterns', () => {
    expect(validateAnswer({ choice: 'yes', patterns: [p(['a'], 1)] }, ctx)).toEqual({
      ok: true,
      value: { choice: 'yes', patterns: [] },
    });
  });

  it('accepts a single person pattern', () => {
    expect(validateAnswer({ choice: 'cond', patterns: [p(['a', 'b'], 2)] }, ctx)).toEqual({
      ok: true,
      value: { choice: 'cond', patterns: [p(['a', 'b'], 2)] },
    });
  });

  it('accepts a headcount pattern', () => {
    expect(validateAnswer({ choice: 'cond', patterns: [p([], 0, 3)] }, ctx).ok).toBe(true);
  });

  it('accepts several OR-patterns', () => {
    const r = validateAnswer({ choice: 'cond', patterns: [p(['a', 'b'], 2), p(['b', 'c'], 2), p([], 0, 3)] }, ctx);
    expect(r.ok).toBe(true);
  });

  it('rejects no patterns and too many patterns', () => {
    const none = validateAnswer({ choice: 'cond', patterns: [] }, ctx);
    expect(!none.ok && none.fields.patterns).toBeTruthy();
    const missing = validateAnswer({ choice: 'cond' }, ctx);
    expect(!missing.ok && missing.fields.patterns).toBeTruthy();
    const many = validateAnswer({ choice: 'cond', patterns: Array.from({ length: 6 }, () => p(['a'], 1)) }, ctx);
    expect(!many.ok && many.fields.patterns).toBeTruthy();
  });

  it.each([
    ['self selected', p(['me'], 1), 'patterns.1.people'],
    ['duplicate', p(['a', 'a'], 1), 'patterns.1.people'],
    ['other room', p(['zzz'], 1), 'patterns.1.people'],
    ['N too large', p(['a'], 2), 'patterns.1.need'],
    ['N zero with people', p(['a'], 0), 'patterns.1.need'],
    ['N without people', p([], 1), 'patterns.1.need'],
    ['N non-integer', p(['a', 'b'], 1.5), 'patterns.1.need'],
    ['M too large', p([], 0, 4), 'patterns.1.minTotal'],
    ['M negative', p([], 0, -1), 'patterns.1.minTotal'],
    ['empty pattern', p([], 0, 0), 'patterns.1'],
  ])('rejects %s in the 2nd pattern with an indexed field', (_label, bad, field) => {
    const r = validateAnswer({ choice: 'cond', patterns: [p(['a'], 1), bad] }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toContain(field);
  });
});

describe('hasStaleCondition', () => {
  it('detects removed members in any pattern', () => {
    expect(hasStaleCondition([p(['a'], 1), p(['gone'], 1)], ['a'])).toBe(true);
    expect(hasStaleCondition([p(['a'], 1), p([], 0, 2)], ['a'])).toBe(false);
  });
});
