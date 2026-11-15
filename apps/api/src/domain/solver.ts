import type { Choice, Condition } from './types.js';

export interface SolverAnswer extends Condition {
  choice: Choice;
}

/**
 * Computes the maximum attendee set that satisfies every conditional answer (spec §6).
 *
 * Start with everyone who answered "yes" or "cond", then repeatedly drop conditional
 * members whose conditions fail, until nothing changes. Because every condition is
 * monotone (more attendees never breaks a condition), the fixed point is the unique
 * maximum feasible set.
 *
 * - Members without an answer are treated as not attending.
 * - Ids in condPeople that are not in `memberIds` (removed members) count as absent.
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
      if (!isSatisfied(id, a, attending)) removals.push(id);
    }
    for (const id of removals) attending.delete(id);
    if (removals.length > 0) changed = true;
  }
  return attending;
}

export function isSatisfied(selfId: string, cond: Condition, attending: ReadonlySet<string>): boolean {
  if (cond.condNeed >= 1) {
    let present = 0;
    for (const p of cond.condPeople) if (p !== selfId && attending.has(p)) present++;
    if (present < cond.condNeed) return false;
  }
  if (cond.condMinTotal >= 1) {
    const others = attending.size - (attending.has(selfId) ? 1 : 0);
    if (others < cond.condMinTotal) return false;
  }
  return true;
}
