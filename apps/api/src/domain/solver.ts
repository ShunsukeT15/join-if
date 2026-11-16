import type { Choice, Pattern } from './types.js';

export interface SolverAnswer {
  choice: Choice;
  patterns: Pattern[];
}

/**
 * Computes the maximum attendee set that satisfies every conditional answer (spec §6).
 *
 * Start with everyone who answered "yes" or "cond", then repeatedly drop conditional
 * members none of whose patterns holds, until nothing changes.
 *
 * Every condition is monotone: a pattern (AND of "≥N of these people" and "≥M others")
 * never breaks when more people attend, and an OR of monotone patterns is monotone too.
 * Hence the union of feasible sets is feasible, the maximum feasible set is unique,
 * and the fixed point of this removal process equals it. Negative conditions
 * ("I won't go if X goes") would break this and remain out of scope.
 *
 * - Members without an answer are treated as not attending.
 * - Ids in a pattern that are not in `memberIds` (removed members) count as absent.
 */
export function solve(
  memberIds: readonly string[],
  answers: ReadonlyMap<string, SolverAnswer>,
): Set<string> {
  const attending = new Set<string>();
  for (const id of memberIds) {
    const a = answers.get(id);
    if (a && (a.choice === 'yes' || a.choice === 'cond')) attending.add(id);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const removals: string[] = [];
    for (const id of attending) {
      const a = answers.get(id);
      if (a?.choice !== 'cond') continue;
      if (!isSatisfied(id, a.patterns, attending)) removals.push(id);
    }
    for (const id of removals) attending.delete(id);
    if (removals.length > 0) changed = true;
  }
  return attending;
}

/** OR over patterns. An empty list is never satisfied. */
export function isSatisfied(selfId: string, patterns: readonly Pattern[], attending: ReadonlySet<string>): boolean {
  return patterns.some((p) => patternHolds(selfId, p, attending));
}

/** AND of the person part and the headcount part. */
export function patternHolds(selfId: string, p: Pattern, attending: ReadonlySet<string>): boolean {
  if (p.need >= 1) {
    let present = 0;
    for (const id of p.people) if (id !== selfId && attending.has(id)) present++;
    if (present < p.need) return false;
  }
  if (p.minTotal >= 1) {
    const others = attending.size - (attending.has(selfId) ? 1 : 0);
    if (others < p.minTotal) return false;
  }
  // A pattern with neither part is rejected by validation; treat it as unsatisfiable.
  return p.need >= 1 || p.minTotal >= 1;
}
