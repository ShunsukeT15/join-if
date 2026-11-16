import { describe, expect, it } from 'vitest';
import { describeCondition, describePattern, inviteMessage } from '../src/lib/format';

describe('describePattern', () => {
  it.each([
    [{ people: ['A'], need: 1, minTotal: 0 }, 'Aさんが来るなら'],
    [{ people: ['A', 'B'], need: 2, minTotal: 0 }, 'A・Bさんが全員来るなら'],
    [{ people: ['A', 'B'], need: 1, minTotal: 0 }, 'A・Bさんのうち誰か1人でも来るなら'],
    [{ people: ['A', 'B', 'C'], need: 2, minTotal: 0 }, 'A・B・Cさんのうち2人以上が来るなら'],
    [{ people: [], need: 0, minTotal: 3 }, '自分以外の参加者が3人以上なら'],
    [{ people: ['A'], need: 1, minTotal: 3 }, 'Aさんが来る、かつ自分以外の参加者が3人以上なら'],
  ])('%j', (input, expected) => {
    expect(describePattern(input)).toBe(expected);
  });
});

describe('describeCondition', () => {
  it('single pattern', () => {
    expect(describeCondition([{ people: ['A'], need: 1, minTotal: 0 }])).toBe('Aさんが来るなら行く');
  });
  it('joins patterns with または', () => {
    expect(
      describeCondition([
        { people: ['A', 'B'], need: 2, minTotal: 0 },
        { people: ['B', 'C'], need: 2, minTotal: 0 },
      ]),
    ).toBe('A・Bさんが全員来るなら、またはB・Cさんが全員来るなら行く');
  });
  it('skips empty patterns', () => {
    expect(describeCondition([{ people: [], need: 0, minTotal: 0 }])).toBe('');
  });
});

describe('inviteMessage', () => {
  it('includes the URL and the one-time notice', () => {
    const m = inviteMessage({ name: '佐藤', title: '結婚式', deadlineText: '12/20', url: 'https://x/r/1/i#t' });
    expect(m).toContain('https://x/r/1/i#t');
    expect(m).toContain('1回だけ');
    expect(m).toContain('（締切：12/20）');
  });
});
