import { z } from 'zod';
import { Hash, Id, Instant, Limits, ProfileId, RelativePath, Version } from '#contracts/common';

export const CaseStatus = z.enum([
  'excluded',
  'invalid',
  'pending',
  'running',
  'completed',
  'candidate-failure',
  'budget-exhausted',
  'blocked-input',
  'infrastructure-error',
]);
export const CriterionResult = z.strictObject({
  id: Id,
  mandatory: z.boolean(),
  severity: z.enum(['critical', 'substantive', 'diagnostic']),
  verdict: z.enum(['pass', 'fail', 'error', 'ungraded']),
  reason: z.string().min(1),
  evidencePaths: z.array(RelativePath),
});
export const ResultSchema = z
  .strictObject({
    schemaVersion: z.literal('1.0.0'),
    runId: Id,
    taskId: RelativePath,
    taskVersion: Version,
    profile: ProfileId,
    trial: z.number().int().nonnegative(),
    status: CaseStatus,
    reason: z.string().nullable(),
    gradingStatus: z.enum(['ungraded', 'graded', 'judge-error']),
    strictSuccess: z.boolean(),
    criticalGatesPassed: z.boolean().nullable(),
    criteria: z.array(CriterionResult),
    outcomeId: Id.nullable(),
    usage: z.strictObject({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      candidateCostUsd: z.number().nonnegative().nullable(),
      judgeCostUsd: z.number().nonnegative().nullable(),
      durationMs: z.number().nonnegative(),
      toolAttempts: z.number().int().nonnegative(),
      toolExecutions: z.number().int().nonnegative(),
      committedEffects: z.number().int().nonnegative(),
    }),
    artifacts: z.array(z.strictObject({ path: RelativePath, sha256: Hash })),
  })
  .superRefine((result, ctx) => {
    if (result.criteria.some((c) => c.severity === 'critical' && !c.mandatory))
      ctx.addIssue({ code: 'custom', message: 'Critical result criteria must be mandatory' });
    const mandatory = result.criteria.filter((c) => c.mandatory);
    const success =
      result.status === 'completed' &&
      result.gradingStatus === 'graded' &&
      mandatory.length > 0 &&
      mandatory.every((c) => c.verdict === 'pass');
    if (result.strictSuccess !== success)
      ctx.addIssue({
        code: 'custom',
        message: 'strictSuccess disagrees with execution or mandatory criteria',
      });
    const critical = result.criteria.filter((c) => c.severity === 'critical');
    const gate =
      critical.length === 0 ||
      critical.some((c) => c.verdict === 'ungraded' || c.verdict === 'error')
        ? null
        : critical.every((c) => c.verdict === 'pass');
    if (result.criticalGatesPassed !== gate)
      ctx.addIssue({
        code: 'custom',
        message: 'Critical gate result disagrees with criterion evidence',
      });
    if (
      result.gradingStatus === 'graded' &&
      result.criteria.some((c) => ['error', 'ungraded'].includes(c.verdict))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'A graded result cannot contain ungraded/error criteria',
      });
    }
  });
export const RunManifestSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  runId: Id,
  createdAt: Instant,
  suiteId: Id,
  suiteVersion: Version,
  suiteHash: Hash,
  profile: ProfileId,
  profileHash: Hash,
  policyHash: Hash,
  systemPromptHash: Hash,
  toolSchemaHash: Hash,
  parserHash: Hash,
  fixturesHash: Hash,
  operatorScriptHash: Hash,
  guriRevision: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  candidate: z.strictObject({
    provider: Id,
    model: z.string().min(1),
    parameters: z.record(z.string(), z.json()),
  }),
  judges: z.array(
    z.strictObject({
      provider: Id,
      model: z.string().min(1),
      parameters: z.record(z.string(), z.json()),
    }),
  ),
  pricingSnapshot: z.strictObject({ version: Version, asOf: Instant, sha256: Hash }),
  limits: Limits,
  repeats: z.number().int().positive(),
  cases: z
    .array(
      z.strictObject({
        taskId: RelativePath,
        trial: z.number().int().nonnegative(),
        taskHash: Hash,
        status: CaseStatus,
        reason: z.string().nullable(),
      }),
    )
    .min(1),
});
export type CaseResult = z.infer<typeof ResultSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
