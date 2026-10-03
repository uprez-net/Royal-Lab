import { z } from 'zod';
import { Hash, Id, Instant, RelativePath, Version } from '#contracts/common';

// Royal Eve staging profile (#18). The candidate is Guri's composed, deployed
// agent; the benchmark only drives its existing /eve/v1/session surface and
// imports independent fixture-maintainer evidence. Nothing here duplicates a
// product business rule.

const Sha = z.string().regex(/^[a-f0-9]{40}$/);
// Cases are explicit; anything not listed is excluded from the profile.
export const EveCaseSchema = z
  .strictObject({
    id: Id,
    // The Royal-Lab definition this live case reuses (scenario intent only).
    basedOn: RelativePath,
    definitionId: z.string().regex(/^T\d{2}$/),
    kind: z.enum(['read', 'approved-write', 'cancelled-external']),
    // Operator wording; `{label}` and `{marker}` are substituted at run time.
    prompt: z.string().min(1).max(2000),
    // Fixture labels live in the evaluator's environment, never in the repo.
    fixtureLabelEnv: z.string().regex(/^EVE_EVAL_[A-Z0-9_]+$/),
    tool: Id,
    // Absolute dates only: the deployed clock is dynamic, not the fake clock.
    absoluteDate: z.iso.date().nullable(),
    inputProfileDifferences: z.array(z.string().min(1)),
  })
  .superRefine((item, ctx) => {
    if (item.kind === 'approved-write' && !item.prompt.includes('{marker}'))
      ctx.addIssue({ code: 'custom', message: 'A disposable write must carry the run marker' });
  });
export type EveCase = z.infer<typeof EveCaseSchema>;
export const EveDeploymentSchema = z
  .strictObject({
    transport: z.literal('eve-http-session'),
    // MCP exposes invocation lifecycle tools for the same agent; it would be a
    // separately declared transport profile and is not enabled here.
    mcpTransport: z.literal('not-enabled'),
    infoVersion: z.number().int().positive(),
    // Pinned privately before execution; null blocks preflight.
    agentCommit: Sha.nullable(),
    deploymentHost: z.string().min(1).nullable(),
    model: z.string().min(1),
    modelSource: z.string().min(1),
    promptsHash: Hash.nullable(),
    toolCatalogueHash: Hash.nullable(),
    specialists: z.array(Id).min(1),
    requiredFlags: z.array(z.enum(['operationsAgentEnabled', 'specialistsEnabled'])).min(1),
    budgets: z.strictObject({
      maxTurnMs: z.number().int().positive(),
      maxTurns: z.number().int().positive(),
    }),
    databaseLabel: z.string().min(1),
    fixtureVersion: z.string().min(1),
    clock: z.literal('dynamic-absolute-dates'),
    tokenTtlSeconds: z.number().int().positive().max(300),
    refreshMarginSeconds: z.number().int().positive(),
    neverApprove: z.array(Id).min(1),
    supportedCases: z.array(EveCaseSchema).min(1),
    exclusions: z.array(z.strictObject({ scope: z.string().min(1), reason: z.string().min(1) })),
  })
  .superRefine((deployment, ctx) => {
    for (const item of deployment.supportedCases)
      if (item.kind === 'approved-write' && deployment.neverApprove.includes(item.tool))
        ctx.addIssue({ code: 'custom', message: `${item.id} would approve a never-approve tool` });
    if (
      new Set(deployment.supportedCases.map((item) => item.id)).size !==
      deployment.supportedCases.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate Eve case id' });
  });
export type EveDeployment = z.infer<typeof EveDeploymentSchema>;

// What the bootstrap and info routes reported, frozen per run.
export const EveTargetEvidenceSchema = z.strictObject({
  origin: z.url(),
  environment: z.literal('preview'),
  deployment: z.string().nullable(),
  databaseLabel: z.string().nullable(),
  fixtureVersion: z.string().nullable(),
  operationsAgentEnabled: z.boolean(),
  specialistsEnabled: z.boolean(),
  infoKind: z.string(),
  infoVersion: z.number().int(),
  checkedAt: Instant,
});
export type EveTargetEvidence = z.infer<typeof EveTargetEvidenceSchema>;

// Independent durable evidence imported from the separate fixture maintainer
// (`eve:eval:fixtures verify`, run on a machine with the staging DB credential).
export const EveDurableEvidenceSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  source: z.literal('eve-eval-fixtures verify'),
  productRevision: Sha,
  operatorRole: z.literal('fixture-maintainer'),
  producedAt: Instant,
  importedAt: Instant,
  databaseLabel: z.string().min(1),
  fixtureVersion: z.string().min(1),
  windowHours: z.number().int().positive(),
  exitCode: z.number().int(),
  rawHash: Hash,
  leadTasks: z.array(
    z.strictObject({
      id: z.string(),
      status: z.string(),
      completedAt: z.string().nullable(),
      notes: z.string(),
    }),
  ),
  operations: z.array(
    z.strictObject({ status: z.string(), action: z.string(), operationKey: z.string() }),
  ),
  audits: z.array(
    z.strictObject({
      status: z.string(),
      toolName: z.string(),
      approval: z.string().nullable(),
      target: z.string().nullable(),
    }),
  ),
});
export type EveDurableEvidence = z.infer<typeof EveDurableEvidenceSchema>;

export const EveRunRecordSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  runId: Id,
  caseId: Id,
  profileVersion: Version,
  deploymentHash: Hash,
  marker: z.string().min(1).nullable(),
  target: EveTargetEvidenceSchema,
  rootSessionId: z.string().min(1).nullable(),
  outcome: z.enum(['completed', 'infrastructure-error', 'credential-expired', 'blocked-input']),
  reason: z.string().nullable(),
  credentialRefreshes: z.number().int().nonnegative(),
  startedAt: Instant,
  finishedAt: Instant,
});
export type EveRunRecord = z.infer<typeof EveRunRecordSchema>;
