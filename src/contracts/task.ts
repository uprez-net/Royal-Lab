import { z } from 'zod';
import { Clock, Hash, Id, Limits, ProfileId, RelativePath, Tool, Version } from '#contracts/common';

export const InputFile = z.strictObject({
  id: Id,
  path: RelativePath,
  sha256: Hash,
  kind: z.enum(['document', 'policy']),
  mediaType: z.string().min(1),
});
export const TaskSchema = z
  .strictObject({
    schemaVersion: z.enum(['1.0.0', '1.1.0']),
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
    if (task.schemaVersion === '1.1.0' && (!task.verificationPath || !task.verificationHash))
      ctx.addIssue({
        code: 'custom',
        message: 'Task 1.1.0 requires a frozen verifier path and hash',
      });
    if (task.schemaVersion === '1.0.0' && (task.verificationPath || task.verificationHash))
      ctx.addIssue({ code: 'custom', message: 'Verifier references require task schema 1.1.0' });
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
