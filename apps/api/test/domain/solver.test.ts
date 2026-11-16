import { describe, expect, it } from 'vitest';
import { isSatisfied, solve, type SolverAnswer } from '../../src/domain/solver.js';
import type { Pattern } from '../../src/domain/types.js';

const yes: SolverAnswer = { choice: 'yes', patterns: [] };
const no: SolverAnswer = { choice: 'no', patterns: [] };
const pat = (people: string[], need: number, minTotal = 0): Pattern => ({ people, need, minTotal });
/** A single-pattern conditional answer. */
const cond = (people: string[], need: number, minTotal = 0): SolverAnswer => ({
  choice: 'cond',
  patterns: [pat(people, need, minTotal)],
});
/** OR of several patterns. */
const anyOf = (...patterns: Pattern[]): SolverAnswer => ({ choice: 'cond', patterns });

const run = (answers: Record<string, SolverAnswer | undefined>, members = Object.keys(answers)) => {
  const map = new Map<string, SolverAnswer>();
  for (const [k, v] of Object.entries(answers)) if (v) map.set(k, v);
  return [...solve(members, map)].sort();
};

describe('solve: spec §6.4 examples', () => {
  it('mutual conditions → both attend', () => {
    expect(run({ A: cond(['B'], 1), B: cond(['A'], 1) })).toEqual(['A', 'B']);
  });

  it('condition target does not come → neither attends', () => {
    expect(run({ A: cond(['B'], 1), B: no })).toEqual([]);
  });

  it('chain → all four attend', () => {
    expect(
      run({ A: yes, B: cond(['A', 'C'], 2), C: cond([], 0, 3), D: cond(['B'], 1) }),
    ).toEqual(['A', 'B', 'C', 'D']);
  });

  it('broken chain → only A attends', () => {
    expect(
      run({ A: yes, B: cond(['A', 'C'], 2), C: cond([], 0, 4), D: cond(['B'], 1) }),
    ).toEqual(['A']);
  });
});

describe('solve: edge cases', () => {
  it('unanswered members are absent', () => {
    expect(run({ A: yes, B: undefined, C: cond(['B'], 1) }, ['A', 'B', 'C'])).toEqual(['A']);
  });

  it('removed members in condPeople count as absent', () => {
    expect(run({ A: yes, C: cond(['A', 'GONE'], 2) })).toEqual(['A']);
    expect(run({ A: yes, C: cond(['A', 'GONE'], 1) })).toEqual(['A', 'C']);
  });

  it('answers for ids outside memberIds are ignored', () => {
    expect(run({ A: yes, X: yes }, ['A'])).toEqual(['A']);
  });

  it('both conditions must hold', () => {
    expect(run({ A: yes, B: cond(['A'], 1, 2) })).toEqual(['A']);
    expect(run({ A: yes, C: yes, B: cond(['A'], 1, 2) })).toEqual(['A', 'B', 'C']);
  });

  it('empty room', () => {
    expect(run({})).toEqual([]);
  });
});

describe('solve: OR of patterns', () => {
  // "(A and B) or (B and C)"
  const xWants = anyOf(pat(['A', 'B'], 2), pat(['B', 'C'], 2));

  it('first pattern holds', () => {
    expect(run({ X: xWants, A: yes, B: yes, C: no })).toEqual(['A', 'B', 'X']);
  });

  it('second pattern holds', () => {
    expect(run({ X: xWants, A: no, B: yes, C: yes })).toEqual(['B', 'C', 'X']);
  });

  it('neither holds (A and C without B)', () => {
    expect(run({ X: xWants, A: yes, B: no, C: yes })).toEqual(['A', 'C']);
  });

  it('a single "2 of A,B,C" pattern would wrongly accept A and C', () => {
    expect(run({ X: cond(['A', 'B', 'C'], 2), A: yes, B: no, C: yes })).toEqual(['A', 'C', 'X']);
  });

  it('person OR headcount: "if A comes, or if 3 others come"', () => {
    const x = anyOf(pat(['A'], 1), pat([], 0, 3));
    expect(run({ X: x, A: yes, B: no, C: no, D: no })).toEqual(['A', 'X']);
    expect(run({ X: x, A: no, B: yes, C: yes, D: yes })).toEqual(['B', 'C', 'D', 'X']);
    expect(run({ X: x, A: no, B: yes, C: yes, D: no })).toEqual(['B', 'C']);
  });

  it('mutual OR conditions keep both', () => {
    expect(
      run({ X: anyOf(pat(['Y'], 1), pat(['Z'], 1)), Y: anyOf(pat(['X'], 1)), Z: no }),
    ).toEqual(['X', 'Y']);
  });

  it('an OR pattern can rescue a chain that a single pattern would break', () => {
    // C needs 4 others (impossible with 4 members) OR A; B needs A and C; D needs B.
    const answers = { A: yes, B: cond(['A', 'C'], 2), C: anyOf(pat([], 0, 4), pat(['A'], 1)), D: cond(['B'], 1) };
    expect(run(answers)).toEqual(['A', 'B', 'C', 'D']);
  });
});

// ---- Brute force cross-check (spec §10.1: ≤12 people, 10,000 cases) ----

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCase(rand: () => number) {
  const n = 1 + Math.floor(rand() * 12);
  const ids = Array.from({ length: n }, (_, i) => `m${i}`);
  const answers = new Map<string, SolverAnswer>();
  for (const id of ids) {
    const r = rand();
    if (r < 0.1) continue; // unanswered
    if (r < 0.3) answers.set(id, yes);
    else if (r < 0.4) answers.set(id, no);
    else {
      // 1–3 OR-patterns, each an AND of a person part and/or a headcount part.
      const count = 1 + Math.floor(rand() * 3);
      const patterns: Pattern[] = [];
      for (let k = 0; k < count; k++) {
        const others = ids.filter((x) => x !== id && rand() < 0.35);
        // include a removed member sometimes
        if (rand() < 0.1) others.push('removed');
        const usePeople = others.length > 0 && rand() < 0.8;
        const need = usePeople ? 1 + Math.floor(rand() * others.length) : 0;
        const useTotal = !usePeople || rand() < 0.3;
        const minTotal = useTotal && n > 1 ? 1 + Math.floor(rand() * (n - 1)) : 0;
        if (need > 0 || minTotal > 0) patterns.push(pat(usePeople ? others : [], need, minTotal));
      }
      answers.set(id, patterns.length ? { choice: 'cond', patterns } : yes);
    }
  }
  return { ids, answers };
}

function bruteForce(ids: string[], answers: Map<string, SolverAnswer>): { best: Set<string>; unique: boolean } {
  const candidates = ids.filter((id) => {
    const c = answers.get(id)?.choice;
    return c === 'yes' || c === 'cond';
  });
  let best = new Set<string>();
  let bestCount = 0;
  let unique = true;
  for (let mask = 0; mask < 1 << candidates.length; mask++) {
    const set = new Set<string>();
    candidates.forEach((id, i) => {
      if (mask & (1 << i)) set.add(id);
    });
    const feasible = [...set].every((id) => {
      const a = answers.get(id)!;
      return a.choice === 'yes' || isSatisfied(id, a.patterns, set);
    });
    if (!feasible) continue;
    if (set.size > best.size) {
      best = set;
      bestCount = 1;
    } else if (set.size === best.size) {
      bestCount++;
    }
  }
  unique = bestCount === 1;
  return { best, unique };
}

describe('solve: brute force cross-check', () => {
  it('matches exhaustive search on 10,000 random cases (1–3 OR-patterns each)', () => {
    const rand = mulberry32(20261115);
    for (let i = 0; i < 10_000; i++) {
      const { ids, answers } = randomCase(rand);
      const got = solve(ids, answers);
      const { best, unique } = bruteForce(ids, answers);
      expect(unique, `case ${i}: maximum must be unique`).toBe(true);
      expect([...got].sort(), `case ${i}`).toEqual([...best].sort());
    }
  }, 60_000);
});

describe('solve: performance', () => {
  it('100 members in under 1 second (worst-case chain)', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `m${i}`);
    const answers = new Map<string, SolverAnswer>();
    // m0 needs 99 others but m99 declines; m_i depends on m_{i-1}
    // → one removal per iteration, a full cascade of 99 rounds.
    ids.forEach((id, i) => {
      const prev = ids[i - 1];
      // Five OR-patterns each, all of which fail once the chain collapses.
      answers.set(
        id,
        prev ? anyOf(pat([prev], 1), pat([], 0, 99), pat([prev], 1, 98), pat([], 0, 99), pat([prev], 1)) : cond([], 0, 99),
      );
    });
    answers.set('m99', no);
    const t = performance.now();
    const result = solve(ids, answers);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(result.size).toBe(0);
  });
});
