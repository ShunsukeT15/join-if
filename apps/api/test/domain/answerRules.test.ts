import { describe, expect, it } from 'vitest';
import { hasStaleCondition, validateAnswer } from '../../src/domain/answerRules.js';

const ctx = { selfId: 'me', memberIds: ['me', 'a', 'b', 'c'] };

describe('validateAnswer', () => {
  it('yes/no discard conditions', () => {
    expect(validateAnswer({ choice: 'yes', condPeople: ['a'], condNeed: 1 }, ctx)).toEqual({
      ok: true,
      value: { choice: 'yes', condPeople: [], condNeed: 0, condMinTotal: 0 },
    });
  });

  it('accepts a person condition', () => {
    const r = validateAnswer({ choice: 'cond', condPeople: ['a', 'b'], condNeed: 2 }, ctx);
    expect(r).toEqual({ ok: true, value: { choice: 'cond', condPeople: ['a', 'b'], condNeed: 2, condMinTotal: 0 } });
  });

  it('accepts a headcount condition', () => {
    expect(validateAnswer({ choice: 'cond', condMinTotal: 3 }, ctx).ok).toBe(true);
  });

  it.each([
    ['self selected', { condPeople: ['me'], condNeed: 1 }, 'condPeople'],
    ['duplicate', { condPeople: ['a', 'a'], condNeed: 1 }, 'condPeople'],
    ['other room', { condPeople: ['zzz'], condNeed: 1 }, 'condPeople'],
    ['N too large', { condPeople: ['a'], condNeed: 2 }, 'condNeed'],
    ['N zero with people', { condPeople: ['a'], condNeed: 0 }, 'condNeed'],
    ['N without people', { condPeople: [], condNeed: 1 }, 'condNeed'],
    ['N non-integer', { condPeople: ['a', 'b'], condNeed: 1.5 }, 'condNeed'],
    ['M too large', { condMinTotal: 4 }, 'condMinTotal'],
    ['M negative', { condMinTotal: -1 }, 'condMinTotal'],
    ['no condition', {}, 'choice'],
  ])('rejects %s', (_label, extra, field) => {
    const r = validateAnswer({ choice: 'cond', ...extra }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toContain(field);
  });
});

describe('hasStaleCondition', () => {
  it('detects removed members', () => {
    expect(hasStaleCondition({ condPeople: ['a', 'gone'], condNeed: 1, condMinTotal: 0 }, ['a'])).toBe(true);
    expect(hasStaleCondition({ condPeople: ['a'], condNeed: 1, condMinTotal: 0 }, ['a'])).toBe(false);
  });
});
