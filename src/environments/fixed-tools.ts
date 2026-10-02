import { z } from 'zod';
import { DOCUMENT_TOOL_SCHEMAS, type DocumentWorkspace } from '#src/environments/documents';
import {
  GURI_TOOL_SCHEMAS,
  guriTool,
  GURI_EFFECTS,
  parseGuriArguments,
} from '#src/environments/guri/tools';
import { GuriBridge } from '#src/environments/guri/bridge';
import { Session } from '#src/environments/session';
import { Interactions, type InteractionEvent } from '#src/harness/interactions';
import type { ScriptedOperator } from '#src/harness/operator';

export const FIXED_TOOL_SCHEMAS = {
  ...DOCUMENT_TOOL_SCHEMAS,
  ...GURI_TOOL_SCHEMAS,
  ask_operator: z.strictObject({ question: z.string().min(1).max(2000) }),
};
// Trusted harness controls from an authored case environment. They change what
// the candidate observes, never what canonical commands decide or approval binds.
export interface EnvironmentController {
  // The Nth committed result of this tool is withheld: the candidate receives an
  // uncertain-outcome error while the canonical effect remains committed.
  acknowledgementLoss?: { tool: string; occurrence: number } | undefined;
  // A canonical concurrent requirements edit armed by the first successful read
  // of the project and fired before the first write to it, whatever call IDs a
  // candidate chooses. Uses the existing offline-control stale injection.
  staleVersion?:
    | { injectionId: string; projectId: string; clock: string; patch: { summary: string } }
    | undefined;
}
export interface ControllerEvent {
  kind: 'acknowledgement-loss' | 'stale-version-injection';
  tool: string;
  callId: string;
  readCallId?: string;
  status: string;
}
// Writes park at the controller's explicit approval boundary before canonical dispatch.
// Approval prose in source documents is never consulted.
export class FixedToolsEnvironment {
  readonly interactions: Interactions;
  readonly controllerEvents: ControllerEvent[] = [];
  private emit: (event: Record<string, unknown>) => void = () => {};
  private committed = new Set<string>();
  private acknowledged = 0;
  private staleRead: string | null = null;
  private staleFired = false;
  constructor(
    readonly documents: DocumentWorkspace,
    readonly bridge: GuriBridge,
    readonly session: Session,
    operator: ScriptedOperator,
    readonly controller: EnvironmentController = {},
  ) {
    this.interactions = new Interactions(session, operator, (event) => this.record(event));
  }
  private async dispatch(tool: string, args: Record<string, unknown>, callId: string) {
    const stale = this.controller.staleVersion;
    if (
      stale &&
      !this.staleFired &&
      this.staleRead &&
      tool === 'update_project_requirements' &&
      args.projectId === stale.projectId
    ) {
      const armed = new GuriBridge(
        this.bridge.checkout,
        this.bridge.runtimeDirectory,
        this.bridge.databaseUrl,
        this.bridge.clock,
        {
          schemaVersion: '1.0.0',
          mode: 'offline-control',
          timeoutMs: this.bridge.controls.timeoutMs,
          staleVersion: {
            schemaVersion: '1.0.0',
            injectionId: stale.injectionId,
            projectId: stale.projectId,
            afterReadCallId: this.staleRead,
            beforeWriteCallId: callId,
            clock: stale.clock,
            patch: stale.patch,
          },
        },
      );
      // Re-arm on the same read identity (read-only), then fire before this write.
      await armed.execute(
        'get_project_requirements',
        { projectId: stale.projectId },
        this.session,
        this.staleRead,
      );
      this.staleFired = true;
      const result = await armed.execute(tool, args, this.session, callId);
      this.controllerEvents.push({
        kind: 'stale-version-injection',
        tool,
        callId,
        readCallId: this.staleRead,
        status: result.status,
      });
      return result;
    }
    const result = await this.bridge.execute(tool, args, this.session, callId);
    if (
      stale &&
      !this.staleRead &&
      tool === 'get_project_requirements' &&
      args.projectId === stale.projectId &&
      result.status === 'success'
    )
      this.staleRead = callId;
    return result;
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
    const result = await this.dispatch(tool, args as Record<string, unknown>, callId);
    const loss = this.controller.acknowledgementLoss;
    if (loss && loss.tool === tool && result.status === 'committed') {
      this.acknowledged++;
      if (this.acknowledged === loss.occurrence) {
        this.controllerEvents.push({
          kind: 'acknowledgement-loss',
          tool,
          callId,
          status: result.status,
        });
        throw new Error(
          'ACKNOWLEDGEMENT_LOST: the response to this call was lost and its outcome is unknown; read current state before any retry',
        );
      }
    }
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
