import { z } from 'zod';
import { Hash, Id, RelativePath, Review, Version } from '#contracts/common';
import { BridgeControlsSchema } from '#contracts/operational';
import { InteractionScriptSchema } from '#src/harness/operator';

// Hidden per-case authoring material for task schema 1.2.0. Nothing here is
// candidate-visible; validation projects only declared documents/policies.

// Explicit synthetic fixture rows inserted in order on an isolated run database.
// Values are parameterized; `{ "$json": value }` marks a jsonb column value.
export const SEED_TABLES = [
  'User',
  'Customer',
  'Lead',
  'LeadTask',
  'Offer',
  'Envelope',
  'Project',
  'Milestone',
  'CertifierEngagement',
  'ComplianceDocument',
  'File',
  'Tradie',
  'TradieSchedule',
  'Invoice',
] as const;
export const CaseSeedSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  rows: z
    .array(
      z.strictObject({
        table: z.enum(SEED_TABLES),
        values: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/), z.json()),
      }),
    )
    .min(1),
});
export type CaseSeed = z.infer<typeof CaseSeedSchema>;

export const CaseEnvironmentSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  version: Version,
  taskId: RelativePath,
  review: Review,
  session: z.strictObject({ sessionId: Id, ownerId: Id }),
  seed: CaseSeedSchema,
  operator: InteractionScriptSchema,
  bridge: BridgeControlsSchema,
  // Trusted harness controls. They change what the candidate observes, never
  // what canonical commands decide or what approval binds.
  controller: z.strictObject({
    // Read-only transport/specialist faults; never simulates a committed write.
    readFailure: z
      .strictObject({
        tool: Id,
        occurrence: z.number().int().positive(),
        kind: z.enum(['timeout', 'specialist-error']),
      })
      .optional(),
    acknowledgementLoss: z
      .strictObject({ tool: Id, occurrence: z.number().int().positive() })
      .optional(),
    // Armed by the first successful requirements read, fired before the first
    // write to that project; uses the existing canonical stale injection.
    staleVersion: z
      .strictObject({
        injectionId: Id,
        projectId: z.string().min(1).max(100),
        clock: z.iso.datetime(),
        patch: z.strictObject({ summary: z.string().min(1).max(2000) }),
      })
      .optional(),
  }),
});
export type CaseEnvironment = z.infer<typeof CaseEnvironmentSchema>;

export const FailureMode = z.enum([
  'wrong-amount',
  'wrong-date',
  'wrong-party',
  'wrong-identifier',
  'wrong-decision',
  'invented-value',
  'missed-discrepancy',
  'false-discrepancy',
  'fabricated-citation',
  'false-success',
  'premature-write',
  'unapproved-write',
  'duplicate-write',
  'stale-overwrite',
  'wrong-target',
  'forbidden-effect',
  'injection-followed',
  'protected-state-changed',
]);
const Verdict = z.enum(['pass', 'fail', 'error', 'ungraded']);
const ToolCall = z.strictObject({ tool: Id, arguments: z.json() });
const controlBase = {
  id: Id,
  kind: z.enum(['reference', 'negative']),
  description: z.string().min(1),
  failureMode: FailureMode.nullable(),
  // Complete expectation over every rubric criterion.
  expected: z.record(Id, Verdict),
};
export const CaseControlSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    ...controlBase,
    mode: z.literal('artifacts'),
    outputs: z.array(z.strictObject({ path: RelativePath, sha256: Hash })).min(1),
  }),
  z.strictObject({
    ...controlBase,
    mode: z.literal('trajectory'),
    // Scripted offline transport turns; each turn is one or more tool calls.
    steps: z.array(z.array(ToolCall).min(1)).min(1),
    expectedStatus: z.enum(['completed', 'candidate-failure']).default('completed'),
  }),
]);
export const CaseControlsSchema = z
  .strictObject({
    schemaVersion: z.literal('1.0.0'),
    version: Version,
    taskId: RelativePath,
    rubricVersion: Version,
    review: Review,
    provenance: z.string().min(1),
    controls: z.array(CaseControlSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new Set(value.controls.map((c) => c.id)).size !== value.controls.length)
      issue('Duplicate control ID');
    if (!value.controls.some((c) => c.kind === 'reference'))
      issue('A reference control is required');
    if (!value.controls.some((c) => c.kind === 'negative'))
      issue('At least one consequential negative control is required');
    for (const control of value.controls) {
      if ((control.kind === 'negative') !== (control.failureMode !== null))
        issue(`Control ${control.id}: only negative controls declare a failure mode`);
      const verdicts = Object.values(control.expected);
      if (control.kind === 'reference' && verdicts.some((v) => v === 'fail' || v === 'error'))
        issue(`Reference control ${control.id} must not expect a failure`);
      if (control.kind === 'negative' && !verdicts.includes('fail'))
        issue(`Negative control ${control.id} must fail at least one criterion`);
    }
  });
export type CaseControls = z.infer<typeof CaseControlsSchema>;
export type CaseControl = z.infer<typeof CaseControlSchema>;
