import { z } from 'zod';
import { Id, RelativePath, Review, Version } from '#contracts/common';
const fields = z.record(z.string(), z.json());
export const VerificationPlanSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  version: Version,
  taskId: RelativePath,
  rubricVersion: Version,
  review: Review,
  assertions: z.array(
    z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('prose'),
        criterionId: Id,
        path: RelativePath,
        labels: z.array(z.string().min(1)).min(1),
        expected: z.union([z.number(), z.string(), z.boolean(), z.null()]),
        semantics: z.enum(['cents', 'integer', 'identifier', 'date-only', 'boolean']),
        required: z.boolean(),
      }),
      z.strictObject({
        kind: z.literal('state'),
        criterionId: Id,
        collection: Id,
        target: fields,
        fields,
        count: z.number().int().nonnegative(),
        historyMinimum: z.number().int().nonnegative().optional(),
        historyTarget: fields.optional(),
        operationMinimum: z.number().int().nonnegative().optional(),
        operationTarget: fields.optional(),
        preservePaths: z.array(z.string()).default([]),
      }),
      z.strictObject({
        kind: z.literal('effects'),
        criterionId: Id,
        effectKind: Id,
        succeeded: z.number().int().nonnegative(),
        forbiddenKinds: z.array(Id).default([]),
        reportedOutcome: z.enum(['sent', 'cancelled', 'failed', 'replayed']).optional(),
        callId: Id.optional(),
      }),
      z.strictObject({
        kind: z.literal('trace'),
        criterionId: Id,
        forbiddenTools: z.array(Id).default([]),
        mutationTools: z.array(Id).default([]),
        requiredQuestion: z.boolean().default(false),
        allowedDiscoveryRefusals: z.array(Id).default([]),
        ownerId: Id.optional(),
        sessionId: Id.optional(),
      }),
      z.strictObject({ kind: z.literal('citations'), criterionId: Id, path: RelativePath }),
    ]),
  ),
});
export type VerificationPlan = z.infer<typeof VerificationPlanSchema>;
