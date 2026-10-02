import { z } from 'zod';
import { Hash, Id, Instant, RelativePath, Review, Version } from '#contracts/common';
import { ResultSchema } from '#contracts/result';
import { ParametersSchema } from '#src/harness/adapters/base';

const Text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Nonblank text required');
export const JudgePricingSchema = z.strictObject({
  version: Version,
  asOf: Instant,
  inputUsdPerMillion: z.number().nonnegative(),
  outputUsdPerMillion: z.number().nonnegative(),
});
export const JudgeConfigurationSchema = z.strictObject({
  id: Id,
  transport: z.enum(['direct', 'gateway']),
  model: Text.nullable(),
  parameters: ParametersSchema,
  pricing: JudgePricingSchema.nullable(),
});
export const JudgeProfileSchema = z
  .strictObject({
    schemaVersion: z.literal('1.0.0'),
    id: Id,
    version: Version,
    purpose: z.enum(['exploratory', 'release']),
    scorePolicy: z.literal('all-mandatory-1.0.0'),
    promptVersion: z.literal('criterion-1.0.0'),
    review: Review,
    calibrationHash: Hash.nullable(),
    limits: z.strictObject({
      maxRequests: z.number().int().positive().max(200),
      maxRequestBytes: z.number().int().positive().max(100_000),
      maxOutputTokensPerRequest: z.number().int().positive().max(8000),
      maxInputTokens: z.number().int().positive(),
      maxOutputTokens: z.number().int().positive(),
      maxCostUsd: z.number().positive(),
      timeoutMs: z.number().int().positive().max(60_000),
      maxDurationMs: z.number().int().positive().max(600_000),
    }),
    judges: z.array(JudgeConfigurationSchema).min(1).max(2),
  })
  .superRefine((profile, ctx) => {
    if (profile.judges.length !== (profile.purpose === 'release' ? 2 : 1))
      ctx.addIssue({
        code: 'custom',
        message: 'Release requires two judges; exploratory requires one',
      });
    if (new Set(profile.judges.map((judge) => judge.id)).size !== profile.judges.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate judge identity' });
    if (profile.purpose === 'release' && profile.judges.every((judge) => judge.model !== null)) {
      const configurations = profile.judges.map((judge) =>
        JSON.stringify([judge.transport, judge.model, judge.parameters]),
      );
      if (configurations[0] === configurations[1])
        ctx.addIssue({
          code: 'custom',
          message: 'Release judges must be independently configured',
        });
    }
  });

// This is the complete allowlist sent to a judge. No fixture facts or run metadata.
export const JudgeScopeSchema = z.strictObject({
  criterion: z.strictObject({ id: Id, title: Text, passIf: Text, failIf: Text }),
  deliverables: z.array(z.strictObject({ path: RelativePath, text: z.string() })).min(1),
  sources: z.array(z.strictObject({ sourceId: Id, locator: Text, text: Text })).min(1),
});
export const JudgeEvidenceSchema = z.strictObject({
  kind: z.enum(['deliverable', 'source']),
  ref: Text,
  locator: Text,
  quote: Text,
});
export const JudgeResponseSchema = z.strictObject({
  verdict: z.enum(['pass', 'fail', 'error']),
  explanation: Text,
  evidence: z.array(JudgeEvidenceSchema),
});
export const JudgeRecordSchema = z.strictObject({
  judgeId: Id,
  configurationFingerprint: Hash,
  modelHash: Hash,
  evidenceHash: Hash.nullable(),
  requestHash: Hash.nullable(),
  attempted: z.boolean(),
  rawResponse: z.string().nullable(),
  responseHash: Hash.nullable(),
  rawVerdict: z.string().nullable(),
  rawExplanation: z.string().nullable(),
  operationalError: Text.nullable(),
  verdict: z.enum(['pass', 'fail', 'error']),
  explanation: Text,
  evidence: z.array(JudgeEvidenceSchema),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    costUsd: z.number().nonnegative().nullable(),
    durationMs: z.number().nonnegative(),
  }),
});
export const SemanticReceiptSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  id: Id,
  createdAt: Instant,
  runId: Id,
  taskId: RelativePath,
  executionEvidenceHash: Hash,
  rubricHash: Hash,
  deterministicHash: Hash,
  profile: JudgeProfileSchema,
  profileHash: Hash,
  prompt: Text,
  promptHash: Hash,
  implementationHash: Hash,
  runtime: z.strictObject({ nodeVersion: Text, lockfileHash: Hash, sdkVersion: Text }),
  mode: z.enum(['benchmark', 'calibration', 'offline-control']),
  criteria: z.array(
    z.strictObject({
      criterionId: Id,
      scope: JudgeScopeSchema.nullable(),
      scopeError: Text.nullable(),
      judges: z.array(JudgeRecordSchema).min(1).max(2),
      disagreement: z.boolean(),
    }),
  ),
  result: ResultSchema,
});

export const HumanAdjudicationSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  id: Id,
  createdAt: Instant,
  origin: z.literal('human-supplied'),
  reviewer: Text,
  reviewedAt: Instant,
  receiptPath: RelativePath,
  receiptHash: Hash,
  criterionId: Id,
  judgeRecordHashes: z.array(Hash).min(1).max(2),
  verdict: z.enum(['pass', 'fail']),
  explanation: Text,
  evidence: z.array(JudgeEvidenceSchema).min(1),
  supersedes: Hash.nullable(),
});
export const CalibrationScenario = z.enum([
  'missing-issue',
  'wrong-amount',
  'alternate-wording',
  'abstention',
  'conditional-approval',
  'false-success',
  'prompt-injection',
]);
export const JudgeCalibrationSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  id: Id,
  version: Version,
  profileHash: Hash.nullable(),
  review: Review,
  examples: z.array(
    z.strictObject({
      id: Id,
      scenario: CalibrationScenario,
      scope: JudgeScopeSchema,
      evidenceHash: Hash,
      expected: z.enum(['pass', 'fail']),
      review: Review,
      receiptPath: RelativePath,
      receiptHash: Hash,
      adjudicationPaths: z.array(RelativePath),
    }),
  ),
});
export type JudgeProfile = z.infer<typeof JudgeProfileSchema>;
export type JudgeScope = z.infer<typeof JudgeScopeSchema>;
export type JudgeRecord = z.infer<typeof JudgeRecordSchema>;
export type SemanticReceipt = z.infer<typeof SemanticReceiptSchema>;
