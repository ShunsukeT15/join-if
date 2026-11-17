import { LIMITS } from '@himitsu/contracts';

export { LIMITS };

/**
 * How long data is kept (spec §7.5). Configurable per deployment; see Deps.retention.
 * - afterCloseDays: days after the latest close before a room is deleted
 *   (also: days an event may stay without any community)
 * - unclosedDays: days after creation before a room that is not closed is deleted
 */
export interface RetentionPolicy {
  afterCloseDays: number;
  unclosedDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { afterCloseDays: 30, unclosedDays: 365 };

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
