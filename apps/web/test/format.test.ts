import { describe, expect, it } from 'vitest';
import { describeCondition, inviteMessage } from '../src/lib/format';

describe('describeCondition', () => {
  it.each([
    [{ people: ['A'], need: 1, minTotal: 0 }, 'Aさんが来るなら行く'],
    [{ people: ['A', 'B'], need: 2, minTotal: 0 }, 'A・Bさんが全員来るなら行く'],
    [{ people: ['A', 'B'], need: 1, minTotal: 0 }, 'A・Bさんのうち誰か1人でも来るなら行く'],
    [{ people: ['A', 'B', 'C'], need: 2, minTotal: 0 }, 'A・B・Cさんのうち2人以上が来るなら行く'],
    [{ people: [], need: 0, minTotal: 3 }, '自分以外の参加者が3人以上なら行く'],
    [{ people: ['A'], need: 1, minTotal: 3 }, 'Aさんが来るなら、かつ自分以外の参加者が3人以上なら行く'],
  ])('%j', (input, expected) => {
    expect(describeCondition(input)).toBe(expected);
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
