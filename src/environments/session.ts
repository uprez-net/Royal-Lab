import { sha256 } from '#src/io';
import { Id } from '#contracts/common';
export function stableJson(value: unknown): string {
  if (value === undefined) throw new Error('Cannot bind undefined');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}
export class Session {
  private approvals = new Set<string>();
  constructor(
    readonly id: string,
    readonly ownerId: string,
  ) {
    Id.parse(id);
    Id.parse(ownerId);
  }
  binding(callId: string, tool: string, arguments_: unknown) {
    Id.parse(callId);
    return sha256(
      stableJson({
        sessionId: this.id,
        ownerId: this.ownerId,
        callId,
        tool,
        arguments: arguments_,
      }),
    );
  }
  respond(
    callId: string,
    tool: string,
    arguments_: unknown,
    responder: { sessionId: string; ownerId: string; decision: 'approved' | 'cancelled' },
  ) {
    if (responder.sessionId !== this.id || responder.ownerId !== this.ownerId)
      throw new Error('APPROVAL_WRONG_RESPONDER');
    const binding = this.binding(callId, tool, arguments_);
    if (responder.decision === 'approved') this.approvals.add(binding);
    else this.approvals.delete(binding);
    return binding;
  }
  requireApproval(callId: string, tool: string, arguments_: unknown) {
    if (!this.approvals.has(this.binding(callId, tool, arguments_)))
      throw new Error('APPROVAL_REQUIRED: exact target and arguments must be approved');
  }
}
