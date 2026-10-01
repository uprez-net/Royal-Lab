import { z } from 'zod';
import { Id, Instant, RelativePath } from '#contracts/common';

const base = {
  schemaVersion: z.literal('1.0.0'),
  runId: Id,
  taskId: RelativePath,
  sequence: z.number().int().nonnegative(),
  at: Instant,
};
export const TraceEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('candidate'),
    text: z.string(),
    providerFinishReason: z.string().nullable(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('tool-attempt'),
    callId: Id,
    tool: Id,
    arguments: z.json(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('tool-executed'),
    callId: Id,
    tool: Id,
    outcome: z.enum(['success', 'domain-refusal', 'blocked', 'error']),
    result: z.json(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('approval'),
    callId: Id,
    ownerId: Id,
    decision: z.enum(['requested', 'approved', 'cancelled']),
    bindingHash: z.string().min(1),
  }),
  z.strictObject({
    ...base,
    type: z.literal('effect-committed'),
    callId: Id,
    operationId: Id,
    effect: Id,
    evidencePath: RelativePath,
  }),
  z.strictObject({
    ...base,
    type: z.literal('operator-input'),
    branchId: Id,
    response: z.string(),
  }),
]);
export type TraceEvent = z.infer<typeof TraceEventSchema>;
