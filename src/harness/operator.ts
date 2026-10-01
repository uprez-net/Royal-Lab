import { z } from 'zod';
import { Id, Review } from '#contracts/common';
import type { Session } from '#src/environments/session';
export const InteractionScriptSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  version: z.string(),
  review: Review,
  maxUnexpectedQuestions: z.number().int().min(0).max(10),
  branches: z.array(
    z.strictObject({
      id: Id,
      type: z.enum(['clarification', 'approval', 'stale-version']),
      allWords: z.array(z.string().min(1)).min(1),
      anyWords: z.array(z.string().min(1)),
      response: z.string().min(1),
      decision: z.enum(['approved', 'cancelled']).nullable(),
      responderId: Id,
      maxUses: z.number().int().positive(),
    }),
  ),
});
export type InteractionScript = z.infer<typeof InteractionScriptSchema>;
export interface OperatorReply {
  branchId: string;
  response: string;
  responderId: string;
  decision: 'approved' | 'cancelled' | null;
}
export class ScriptedOperator {
  private uses = new Map<string, number>();
  private unexpected = 0;
  constructor(
    readonly script: InteractionScript,
    readonly mode: 'benchmark' | 'offline-control' = 'benchmark',
  ) {
    InteractionScriptSchema.parse(script);
    if (mode === 'benchmark' && script.review.status !== 'approved')
      throw new Error('OPERATOR_REVIEW_PENDING');
    if (new Set(script.branches.map((branch) => branch.id)).size !== script.branches.length)
      throw new Error('OPERATOR_DUPLICATE_BRANCH');
  }
  answer(question: string, type: 'clarification' | 'approval' | 'stale-version'): OperatorReply {
    const words = new Set(question.toLocaleLowerCase('en-AU').match(/[\p{L}\p{N}]+/gu) ?? []);
    const branches = this.script.branches.filter(
      (branch) =>
        branch.type === type &&
        branch.allWords.every((word) => words.has(word.toLocaleLowerCase('en-AU'))) &&
        (branch.anyWords.length === 0 ||
          branch.anyWords.some((word) => words.has(word.toLocaleLowerCase('en-AU')))) &&
        (this.uses.get(branch.id) ?? 0) < branch.maxUses,
    );
    if (branches.length !== 1) {
      this.unexpected++;
      throw new Error(
        this.unexpected > this.script.maxUnexpectedQuestions
          ? 'OPERATOR_EXHAUSTED'
          : 'OPERATOR_UNMATCHED_QUESTION',
      );
    }
    const branch = branches[0]!;
    this.uses.set(branch.id, (this.uses.get(branch.id) ?? 0) + 1);
    return {
      branchId: branch.id,
      response: branch.response,
      responderId: branch.responderId,
      decision: branch.decision,
    };
  }
}
