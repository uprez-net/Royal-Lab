import { z } from 'zod';
import { Hash, Id, Instant, Limits, ProfileId, RelativePath, Version } from '#contracts/common';
import { CaseStatus } from '#contracts/result';
import { ParametersSchema } from '#src/harness/adapters/base';

// Repeated-trial experiments (#16). An experiment file is the explicit request;
// the plan freezes every selected case, configuration, repeat and hash before any
// candidate request. Trial bundles and the hash-chained ledger are append-only.

export const PricingSnapshot = z.strictObject({
  version: Version,
  asOf: Instant,
  inputUsdPerMillion: z.number().nonnegative(),
  outputUsdPerMillion: z.number().nonnegative(),
  cachedInputUsdPerMillion: z.number().nonnegative().optional(),
});
export const ExperimentConfigurationSchema = z.strictObject({
  id: Id,
  provider: z.enum(['direct', 'gateway']),
  model: z.string().min(1),
  parameters: ParametersSchema.default({}),
  // Only the name of a locally configured credential variable; never the key.
  apiKeyEnv: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .nullable()
    .default(null),
  pricing: PricingSnapshot,
});
export const UsageAssumptions = z.strictObject({
  candidateInputTokensPerTrial: z.number().int().nonnegative(),
  candidateCachedInputTokensPerTrial: z.number().int().nonnegative(),
  candidateOutputTokensPerTrial: z.number().int().nonnegative(),
  judgeInputTokensPerCall: z.number().int().nonnegative(),
  judgeOutputTokensPerCall: z.number().int().nonnegative(),
});
export const ExperimentBudget = z.strictObject({
  perTrialCandidateUsd: z.number().positive(),
  perTrialJudgeUsd: z.number().nonnegative(),
  totalCandidateUsd: z.number().positive(),
  totalJudgeUsd: z.number().nonnegative(),
  maxWallClockMs: z.number().int().positive(),
});
export const ExperimentSpecSchema = z
  .strictObject({
    schemaVersion: z.literal('1.0.0'),
    id: Id,
    version: Version,
    description: z.string().min(1),
    suite: RelativePath,
    // Optional explicit subset; every other suite case stays in the plan as excluded.
    cases: z.array(RelativePath).min(1).nullable().default(null),
    repeats: z.number().int().positive().max(20).default(3),
    seed: z.string().min(1),
    concurrency: z.number().int().min(1).max(16).default(1),
    configurations: z.array(ExperimentConfigurationSchema).min(1).max(8),
    judgeProfile: RelativePath.nullable().default(null),
    // Only the name of the credential variable used for every judge in the
    // profile (one gateway key); never the key. Required to judge a benchmark sweep.
    judgeApiKeyEnv: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .nullable()
      .default(null),
    budget: ExperimentBudget,
    usageAssumptions: UsageAssumptions,
    // SDK transport retries stay disabled: a retried paid request has unknown cost.
    transportRetries: z.literal(0).default(0),
    retention: z
      .strictObject({ traceDays: z.number().int().positive().nullable() })
      .default({ traceDays: null }),
  })
  .superRefine((spec, ctx) => {
    const ids = spec.configurations.map((item) => item.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate configuration id' });
    if (spec.cases && new Set(spec.cases).size !== spec.cases.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate selected case' });
    if (spec.budget.perTrialCandidateUsd > spec.budget.totalCandidateUsd)
      ctx.addIssue({ code: 'custom', message: 'Per-trial candidate ceiling exceeds the total' });
  });
export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>;
export type ExperimentConfiguration = z.infer<typeof ExperimentConfigurationSchema>;

export const PlannedCaseSchema = z.strictObject({
  taskId: RelativePath,
  // Planned into the matrix: explicitly selected and offline integrity passed.
  selected: z.boolean(),
  integrity: z.enum(['valid', 'invalid']),
  // Execution readiness in benchmark mode (actual review etc.); a plan whose
  // preflight is not valid is frozen and shown, but never executed.
  status: z.enum(['ready', 'excluded', 'invalid']),
  reason: z.string().nullable(),
  role: z.enum(['core', 'variant', 'diagnostic', 'specimen']),
  definitionId: z.string().regex(/^[DT]\d{2}$/),
  hashes: z
    .strictObject({
      task: Hash,
      fixture: Hash,
      rubric: Hash,
      provenance: Hash,
      verification: Hash.nullable(),
      policy: Hash,
      sources: Hash,
      controls: Hash.nullable(),
      environment: Hash.nullable(),
    })
    .nullable(),
  semanticCriteria: z.number().int().nonnegative(),
  limits: Limits.nullable(),
});
export const PlannedTrialSchema = z.strictObject({
  trialId: Id,
  sequence: z.number().int().nonnegative(),
  taskId: RelativePath,
  configurationId: Id,
  repeat: z.number().int().nonnegative(),
  // Paired block: one case and repeat across every configuration, in seeded order.
  block: z.number().int().nonnegative(),
  orderInBlock: z.number().int().nonnegative(),
  resources: z.array(Id),
});
export const SpendEstimate = z.strictObject({
  candidateTrials: z.number().int().nonnegative(),
  judgeCalls: z.number().int().nonnegative(),
  expectedCandidateUsd: z.number().nonnegative(),
  expectedJudgeUsd: z.number().nonnegative().nullable(),
  boundedCandidateUsd: z.number().nonnegative(),
  boundedJudgeUsd: z.number().nonnegative(),
  withinBudget: z.boolean(),
  assumptions: z.array(z.string()),
});
export const ExperimentPlanSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  experimentId: Id,
  createdAt: Instant,
  mode: z.enum(['benchmark', 'offline-control']),
  spec: ExperimentSpecSchema,
  specHash: Hash,
  suite: z.strictObject({
    id: Id,
    version: Version,
    split: z.enum(['development', 'held-out']),
    profile: ProfileId,
    hash: Hash,
  }),
  profile: z.strictObject({
    id: ProfileId,
    version: Version,
    hash: Hash,
    systemPromptHash: Hash.nullable(),
    toolSchemaHash: Hash,
    parserProfile: z.string(),
  }),
  runtime: z.strictObject({
    runnerRevision: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    runnerDirty: z.boolean(),
    lockfileHash: Hash,
    nodeVersion: z.string().min(1),
    guriRevision: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
  }),
  configurations: z.array(
    ExperimentConfigurationSchema.extend({ pricingHash: Hash, configurationHash: Hash }),
  ),
  judge: z
    .strictObject({
      profileId: Id,
      profileVersion: Version,
      profileHash: Hash,
      judges: z.number().int().positive(),
    })
    .nullable(),
  preflight: z.strictObject({
    mode: z.enum(['execution-readiness', 'offline-integrity']),
    valid: z.boolean(),
    errors: z.array(z.string()),
  }),
  cases: z.array(PlannedCaseSchema).min(1),
  trials: z.array(PlannedTrialSchema),
  estimate: SpendEstimate,
  planHash: Hash,
});
export type ExperimentPlan = z.infer<typeof ExperimentPlanSchema>;
export type PlannedTrial = z.infer<typeof PlannedTrialSchema>;
export type PlannedCase = z.infer<typeof PlannedCaseSchema>;

// Trial terminal outcomes add orchestration-only states to the case status:
// `interrupted` (started, never finished) and `budget-stopped` (never started
// because a resource ceiling would be exceeded). Neither is a candidate result.
export const TrialStatus = z.union([CaseStatus, z.enum(['interrupted', 'budget-stopped'])]);
export type TrialStatusValue = z.infer<typeof TrialStatus>;
export const TrialUsage = z.strictObject({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  candidateCostUsd: z.number().nonnegative().nullable(),
  judgeCostUsd: z.number().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
});
const eventBase = {
  schemaVersion: z.literal('1.0.0'),
  experimentId: Id,
  sequence: z.number().int().nonnegative(),
  at: Instant,
  previousHash: Hash.nullable(),
  hash: Hash,
};
export const LedgerEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...eventBase, type: z.literal('plan-frozen'), planHash: Hash }),
  z.strictObject({
    ...eventBase,
    type: z.literal('trial-started'),
    trialId: Id,
    attemptOf: Id.nullable(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('trial-finished'),
    trialId: Id,
    status: TrialStatus,
    reason: z.string().nullable(),
    usage: TrialUsage,
    bundleHash: Hash.nullable(),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('trial-graded'),
    trialId: Id,
    gradeFile: RelativePath,
    gradeHash: Hash,
    graderVersion: z.string().min(1),
    strictSuccess: z.boolean(),
    gradingStatus: z.enum(['ungraded', 'graded', 'judge-error']),
  }),
  // A rerun is a new trial; it never replaces the original attempt.
  z.strictObject({
    ...eventBase,
    type: z.literal('rerun-planned'),
    trial: PlannedTrialSchema,
    rerunOf: Id,
    reason: z.string().min(1),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('experiment-stopped'),
    reason: z.string().min(1),
    classification: z.enum(['candidate-budget', 'judge-budget', 'wall-clock', 'unknown-usage']),
  }),
]);
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;
export const TrialBundleReceiptSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  experimentId: Id,
  trialId: Id,
  files: z.array(z.strictObject({ path: RelativePath, sha256: Hash })).min(1),
});
