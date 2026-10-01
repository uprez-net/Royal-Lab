import { z } from 'zod';
import { Id, RelativePath, Version } from '#contracts/common';

const Evidence = z.strictObject({ sourceId: Id, locator: z.string().min(1), fact: z.string().min(1) });
const base = {
  id: Id, title: z.string().min(1), mandatory: z.boolean(),
  severity: z.enum(['critical', 'substantive', 'diagnostic']),
  category: z.enum(['money', 'date', 'party', 'evidence', 'decision', 'approval', 'auth', 'effect', 'replay', 'truthfulness', 'quality']),
  deliverables: z.array(RelativePath), evidence: z.array(Evidence).min(1),
};
export const Criterion = z.discriminatedUnion('method', [
  z.strictObject({ ...base, method: z.literal('deterministic'),
    check: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('json-equals'), deliverable: RelativePath,
        pointer: z.string().regex(/^(\/([^~]|~[01])*)*$/), expected: z.json() }),
      z.strictObject({ kind: z.literal('state-equals'), entity: Id, field: Id, expected: z.json() }),
      z.strictObject({ kind: z.literal('effect-count'), effect: Id, expected: z.number().int().nonnegative() }),
    ]),
  }),
  z.strictObject({ ...base, method: z.literal('semantic'), passIf: z.string().min(1), failIf: z.string().min(1) }),
]);
export const RubricSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'), version: Version,
  taskId: RelativePath, policyVersion: Version,
  criteria: z.array(Criterion).min(1),
}).superRefine((rubric, ctx) => {
  if (!rubric.criteria.some((c) => c.mandatory)) ctx.addIssue({ code: 'custom', message: 'At least one mandatory criterion is required' });
  if (rubric.criteria.some((c) => c.severity === 'critical' && !c.mandatory)) ctx.addIssue({ code: 'custom', message: 'Critical criteria must be mandatory' });
});
export type Rubric = z.infer<typeof RubricSchema>;
