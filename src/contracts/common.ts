import { z } from 'zod';

export const Version = z.string().regex(/^\d+\.\d+\.\d+$/);
export const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const RelativePath = z.string().min(1).refine((value) => {
  const parts = value.split('/');
  return !/[\\:\x00-\x1f%]/.test(value) && !value.startsWith('/') &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..' &&
      !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part));
}, 'Expected a portable relative path without traversal, encoding or device names');
export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const Instant = z.iso.datetime({ offset: true });
export const MoneyCents = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const Review = z.strictObject({
  status: z.enum(['draft', 'approved', 'rejected']),
  reviewer: z.string().min(1).nullable(),
  reviewedAt: Instant.nullable(),
  notes: z.string(),
}).superRefine((review, ctx) => {
  if (review.status !== 'draft' && (!review.reviewer || !review.reviewedAt)) {
    ctx.addIssue({ code: 'custom', message: 'A completed review requires a reviewer and timestamp' });
  }
});
export const Clock = z.strictObject({
  instant: Instant,
  timezone: z.literal('Australia/Sydney'),
});
export const ProfileId = z.enum(['documents', 'fixed-tools', 'royal-eve']);
export const Limits = z.strictObject({
  maxTurns: z.number().int().positive(), maxToolCalls: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
  maxDurationMs: z.number().int().positive(), maxCostUsd: z.number().positive(),
});
export const Tool = z.strictObject({ name: Id, version: Version });
