import { z } from 'zod';
import { DOCUMENT_TOOL_SCHEMAS, type DocumentWorkspace } from '#src/environments/documents';
import {
  GURI_TOOL_SCHEMAS,
  guriTool,
  GURI_EFFECTS,
  parseGuriArguments,
} from '#src/environments/guri/tools';
import type { GuriBridge } from '#src/environments/guri/bridge';
import { Session } from '#src/environments/session';
import { Interactions, type InteractionEvent } from '#src/harness/interactions';
import type { ScriptedOperator } from '#src/harness/operator';

export const FIXED_TOOL_SCHEMAS = {
  ...DOCUMENT_TOOL_SCHEMAS,
  ...GURI_TOOL_SCHEMAS,
  ask_operator: z.strictObject({ question: z.string().min(1).max(2000) }),
};
// Writes park at the controller's explicit approval boundary before canonical dispatch.
// Approval prose in source documents is never consulted.
export class FixedToolsEnvironment {
  readonly interactions: Interactions;
  private emit: (event: Record<string, unknown>) => void = () => {};
  private committed = new Set<string>();
  constructor(
    readonly documents: DocumentWorkspace,
    readonly bridge: GuriBridge,
    readonly session: Session,
    operator: ScriptedOperator,
  ) {
    this.interactions = new Interactions(session, operator, (event) => this.record(event));
  }
  attachTrace = (emit: (event: Record<string, unknown>) => void) => {
    this.emit = emit;
  };
  committedEffects = () => this.committed.size;
  execute = async (name: string, arguments_: unknown, callId: string): Promise<unknown> => {
    if (Object.hasOwn(DOCUMENT_TOOL_SCHEMAS, name)) return this.documents.execute(name, arguments_);
    if (name === 'ask_operator') {
      const args = FIXED_TOOL_SCHEMAS.ask_operator.parse(arguments_);
      return this.interactions.clarify(args.question, callId);
    }
    const tool = guriTool(name);
    const args = parseGuriArguments(tool, arguments_);
    if (GURI_EFFECTS[tool] === 'mutation') {
      this.interactions.approve(
        `Approve ${tool} with exact arguments ${JSON.stringify(args)}?`,
        callId,
        tool,
        args,
      );
      this.session.requireApproval(callId, tool, args);
    }
    const result = await this.bridge.execute(tool, args, this.session, callId);
    if (result.status === 'stale-version') {
      const reply = this.interactions.staleVersion(
        `Refresh stale version for ${tool} before requesting new approval.`,
        callId,
      );
      return { ...result, operatorResponse: reply.response };
    }
    if (!['success', 'committed', 'replayed'].includes(result.status)) {
      throw new Error(result.status === 'domain-refusal' ? 'DOMAIN_REFUSAL' : 'GURI_COMMAND_ERROR');
    }
    return result;
  };
  afterExecution = (
    name: string,
    result: unknown,
    call: string,
    emit: (event: Record<string, unknown>) => void,
  ) => {
    if (
      Object.hasOwn(GURI_EFFECTS, name) &&
      GURI_EFFECTS[guriTool(name)] === 'mutation' &&
      typeof result === 'object' &&
      result &&
      'status' in result &&
      ['committed', 'replayed'].includes(String(result.status))
    ) {
      this.committed.add(call);
      emit({
        type: 'effect-committed',
        callId: call,
        operationId: call,
        effect: name === 'create_lead_task' ? 'lead-task' : name,
        evidencePath: 'state.json',
      });
    }
  };
  private record(event: InteractionEvent) {
    const data = event.data as Record<string, unknown>;
    if (event.type === 'question')
      this.emit({
        type: 'question',
        callId: event.callId,
        ownerId: event.ownerId,
        sessionId: event.sessionId,
        question: data.question,
      });
    else if (event.type === 'operator-input')
      this.emit({
        type: 'operator-input',
        branchId: data.branchId,
        response: data.response,
        responderId: data.responderId,
        sessionId: event.sessionId,
      });
    else
      this.emit({
        type: 'approval',
        callId: event.callId,
        ownerId: data.responderId ?? event.ownerId,
        sessionId: event.sessionId,
        decision: data.decision,
        bindingHash: data.bindingHash,
      });
  }
}
