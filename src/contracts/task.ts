import { z } from 'zod';
import { Clock, Hash, Id, Limits, ProfileId, RelativePath, Tool, Version } from '#contracts/common';

export const InputFile = z.strictObject({
  id: Id,
  path: RelativePath,
  sha256: Hash,
  kind: z.enum(['document', 'policy']),
  mediaType: z.string().min(1),
});
// 1.2.0 adds explicit denominator role and hidden case controls/environment.
// Earlier versions are unchanged and must not carry the new fields.
export const CaseRole = z.enum(['core', 'variant', 'diagnostic']);
export const TaskSchema = z
  .strictObject({
    schemaVersion: z.enum(['1.0.0', '1.1.0', '1.2.0']),
    role: CaseRole.optional(),
    variantOf: RelativePath.nullable().optional(),
    version: Version,
    scenarioVersion: Version,
    id: RelativePath.refine((s) => s.split('/').length >= 2, 'Task ID must include family/case'),
    definitionId: z.string().regex(/^[DT]\d{2}$/),
    title: z.string().min(1),
    family: Id,
    workType: z.enum(['extract', 'reconcile', 'analyze', 'draft', 'operate', 'boundary']),
    instruction: z.string().min(1),
    profiles: z.array(ProfileId).min(1),
    worldId: Id,
    clock: Clock,
    jurisdiction: z.literal('AU-NSW'),
    currency: z.literal('AUD'),
    inputs: z.array(InputFile).min(1),
    tools: z.array(Tool),
    deliverables: z
      .array(
        z.strictObject({
          path: RelativePath,
          mediaType: z.enum(['application/json', 'text/markdown']),
          description: z.string().min(1),
          required: z.boolean(),
        }),
      )
      .min(1),
    fixturePath: RelativePath,
    fixtureHash: Hash,
    rubricPath: RelativePath,
    rubricHash: Hash,
    provenancePath: RelativePath,
    provenanceHash: Hash,
    verificationPath: RelativePath.optional(),
    verificationHash: Hash.optional(),
    controlsPath: RelativePath.optional(),
    controlsHash: Hash.optional(),
    environmentPath: RelativePath.optional(),
    environmentHash: Hash.optional(),
    operatorBranches: z.array(
      z.strictObject({
        id: Id,
        trigger: z.enum(['clarification', 'approval', 'stale-version', 'timeout']),
        response: z.string().min(1),
        allowedOutcomeIds: z.array(Id).min(1),
      }),
    ),
    allowedOutcomes: z.array(z.strictObject({ id: Id, description: z.string().min(1) })).min(1),
    limits: Limits,
  })
  .superRefine((task, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (task.schemaVersion !== '1.0.0' && (!task.verificationPath || !task.verificationHash))
      issue(`Task ${task.schemaVersion} requires a frozen verifier path and hash`);
    if (task.schemaVersion === '1.0.0' && (task.verificationPath || task.verificationHash))
      issue('Verifier references require task schema 1.1.0');
    const authored = [
      task.role,
      task.variantOf,
      task.controlsPath,
      task.controlsHash,
      task.environmentPath,
      task.environmentHash,
    ];
    if (task.schemaVersion !== '1.2.0') {
      if (authored.some((value) => value !== undefined))
        issue('Role, controls and environment references require task schema 1.2.0');
      return;
    }
    if (!task.role || task.variantOf === undefined)
      issue('Task 1.2.0 requires an explicit role and variantOf');
    if (task.role === 'core' && task.variantOf !== null)
      issue('A core case cannot be a variant of another case');
    if (task.role === 'variant' && !task.variantOf)
      issue('A variant must name the core case it varies');
    if (!task.controlsPath || !task.controlsHash)
      issue('Task 1.2.0 requires hidden reference/negative controls');
    const tools = task.profiles.includes('fixed-tools');
    if (tools !== Boolean(task.environmentPath && task.environmentHash))
      issue('A fixed-tools case requires exactly one hidden seeded environment');
    if (!tools && (task.environmentPath || task.environmentHash))
      issue('Document-only cases cannot declare a seeded environment');
  });
export const SuiteSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  id: Id,
  version: Version,
  split: z.enum(['development', 'held-out']),
  profile: ProfileId,
  cases: z.array(RelativePath).min(1),
  description: z.string().min(1),
});
export type Task = z.infer<typeof TaskSchema>;
export type Suite = z.infer<typeof SuiteSchema>;
