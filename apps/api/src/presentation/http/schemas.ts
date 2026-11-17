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

// ISO 8601; range (future, within a year) is checked in the domain.
const deadlineAt = z.string().max(40).nullable().optional();

export const createRoomSchema = z.strictObject({
  title: text(100),
  deadlineText: text(50).optional(),
  message: text(500).optional(),
  inviteMode: z.enum(['individual', 'group']).optional(),
  deadlineAt,
});

export const updateSettingsSchema = z.strictObject({
  title: text(100).optional(),
  communityName: text(50).optional(),
  deadlineText: text(50).optional(),
  message: text(500).optional(),
  deadlineAt,
});

export const createEventSchema = z.strictObject({
  title: text(100),
  message: text(500).optional(),
});

export const updateEventSchema = z.strictObject({
  title: text(100).optional(),
  message: text(500).optional(),
});

export const addCommunitySchema = z.strictObject({
  name: text(50),
  inviteMode: z.enum(['individual', 'group']).optional(),
  deadlineAt,
  message: text(500).optional(),
});

export const groupClaimSchema = z.strictObject({
  memberId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
});

export const addMemberSchema = z.strictObject({
  name: text(50),
});

const patternSchema = z.strictObject({
  people: z.array(z.string().max(64)).max(100),
  need: z.number().int().min(0).max(100),
  minTotal: z.number().int().min(0).max(100),
});

export const saveAnswerSchema = z.strictObject({
  choice: z.enum(['yes', 'no', 'cond']),
  // Upper bound (LIMITS.maxPatterns) is enforced with a friendly message in the domain.
  patterns: z.array(patternSchema).max(20).optional(),
});

export const emptySchema = z.strictObject({});

export const ROOM_ID_PATTERN = /^[A-Za-z0-9]{1,32}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
