import { z } from 'zod';

/**
 * Request body schemas. All objects are strict: unknown keys are rejected with 422
 * (spec §8.4, §8.6) so clients can never smuggle server-owned fields such as
 * memberId, updatedAt, status or attending.
 *
 * Length limits are enforced again in the domain layer after trimming;
 * the generous caps here just bound payload size.
 */

const text = (max: number) => z.string().max(max * 4);

export const createRoomSchema = z.strictObject({
  title: text(100),
  deadlineText: text(50).optional(),
  message: text(500).optional(),
});

export const updateSettingsSchema = z.strictObject({
  title: text(100).optional(),
  deadlineText: text(50).optional(),
  message: text(500).optional(),
});

export const addMemberSchema = z.strictObject({
  name: text(50),
});

export const saveAnswerSchema = z.strictObject({
  choice: z.enum(['yes', 'no', 'cond']),
  condPeople: z.array(z.string().max(64)).max(100).optional(),
  condNeed: z.number().int().min(0).max(100).optional(),
  condMinTotal: z.number().int().min(0).max(100).optional(),
});

export const emptySchema = z.strictObject({});

export const ROOM_ID_PATTERN = /^[A-Za-z0-9]{1,32}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
