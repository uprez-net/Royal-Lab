import type { ScriptedOperator } from '#src/harness/operator';
import type { Session } from '#src/environments/session';
export interface InteractionEvent {
  type: 'question' | 'operator-input' | 'approval';
  callId: string;
  ownerId: string;
  sessionId: string;
  data: unknown;
}
export class Interactions {
  readonly events: InteractionEvent[] = [];
  constructor(
    readonly session: Session,
    readonly operator: ScriptedOperator,
  ) {}
  clarify(question: string, callId: string) {
    this.record('question', callId, { question });
    const reply = this.operator.answer(question, 'clarification');
    this.record('operator-input', callId, reply);
    return reply;
  }
  approve(question: string, callId: string, tool: string, arguments_: unknown) {
    const bindingHash = this.session.binding(callId, tool, arguments_);
    this.record('approval', callId, {
      decision: 'requested',
      tool,
      arguments: arguments_,
      bindingHash,
    });
    const reply = this.operator.answer(question, 'approval');
    this.record('operator-input', callId, reply);
    if (!reply.decision) throw new Error('OPERATOR_APPROVAL_DECISION_MISSING');
    this.session.respond(callId, tool, arguments_, {
      sessionId: this.session.id,
      ownerId: reply.responderId,
      decision: reply.decision,
    });
    this.record('approval', callId, {
      decision: reply.decision,
      bindingHash,
      responderId: reply.responderId,
    });
    return reply;
  }
  private record(type: InteractionEvent['type'], callId: string, data: unknown) {
    this.events.push({
      type,
      callId,
      ownerId: this.session.ownerId,
      sessionId: this.session.id,
      data,
    });
  }
}
