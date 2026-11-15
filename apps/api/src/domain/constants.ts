import { LIMITS } from '@himitsu/contracts';

export { LIMITS };

/** Days after closing before a room is purged. */
export const RETENTION_AFTER_CLOSE_DAYS = 90;
/** Days after creation before a never-closed room is purged. */
export const RETENTION_UNCLOSED_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
