// Normalize Eve NDJSON session streams, recursively through delegated specialist
// sessions. Business tools run inside child sessions: the parent stream only
// names them (`subagent.called` with `childSessionId`). Reading only the parent
// would make every "this write never ran" check pass on a run that wrote.
// Call IDs are unique per session, so every call is keyed by (session, callId).

export type CallStatus = 'pending' | 'completed' | 'failed' | 'rejected';
export interface ObservedCall {
  sessionId: string;
  specialist: string | null;
  callId: string;
  tool: string;
  input: unknown;
  output: unknown;
  status: CallStatus;
  // A background "working" receipt is admission, never completion.
  workingReceipt: boolean;
}
export interface ObservedApproval {
  sessionId: string;
  requestId: string;
  kind: string;
  tool: string;
  callId: string;
  input: unknown;
  prompt: string | null;
  resolution: string | null;
}
export type SessionTerminal = 'completed' | 'failed' | 'cancelled' | 'waiting' | 'running';
export interface ObservedSession {
  sessionId: string;
  parentSessionId: string | null;
  name: string;
  events: number;
  turn: SessionTerminal;
  failures: { code: string; message: string }[];
  finalMessage: string | null;
}
export interface EveObservation {
  sessions: ObservedSession[];
  calls: ObservedCall[];
  approvals: ObservedApproval[];
  // Child sessions that failed, were cancelled or never finished.
  childProblems: {
    sessionId: string;
    name: string;
    turn: SessionTerminal;
    failures: ObservedSession['failures'];
  }[];
  rootTurn: SessionTerminal;
  finalMessage: string | null;
}
export type SessionReader = (sessionId: string) => Promise<unknown[]>;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const isWorkingReceipt = (data: Record<string, unknown>, output: unknown) => {
  const value = record(output);
  return (
    data.backgroundTask !== undefined ||
    value?.status === 'working' ||
    value?.kind === 'working-receipt' ||
    value?.backgroundTask !== undefined
  );
};

function scan(
  sessionId: string,
  parentSessionId: string | null,
  name: string,
  events: unknown[],
  calls: Map<string, ObservedCall>,
  approvals: Map<string, ObservedApproval>,
) {
  const session: ObservedSession = {
    sessionId,
    parentSessionId,
    name,
    events: events.length,
    turn: 'running',
    failures: [],
    finalMessage: null,
  };
  const children: { sessionId: string; name: string }[] = [];
  const key = (callId: unknown) => JSON.stringify([sessionId, String(callId)]);
  const specialist = parentSessionId === null ? null : name;
  const upsert = (
    callId: unknown,
    fields: { [K in keyof ObservedCall]?: ObservedCall[K] | undefined },
  ) => {
    const existing = calls.get(key(callId));
    calls.set(key(callId), {
      sessionId,
      specialist,
      callId: String(callId),
      tool: fields.tool ?? existing?.tool ?? 'unknown',
      input: fields.input ?? existing?.input,
      output: fields.output ?? existing?.output,
      status: fields.status ?? existing?.status ?? 'pending',
      workingReceipt: fields.workingReceipt ?? existing?.workingReceipt ?? false,
    });
  };
  for (const raw of events) {
    const event = record(raw);
    const type = text(event?.type);
    const data = record(event?.data) ?? {};
    switch (type) {
      case 'subagent.event': {
        // Older inline child shape; keep the child scope distinct.
        const inner = data.event;
        const child = text(data.subagentName) ?? 'specialist';
        if (inner !== undefined) {
          const nested = scan(`${sessionId}/${child}`, sessionId, child, [inner], calls, approvals);
          children.push(...nested.children);
        }
        break;
      }
      case 'subagent.called': {
        const child = text(data.childSessionId);
        // Remote children are behind another deployment's auth: recorded as a problem.
        if (child) children.push({ sessionId: child, name: text(data.name) ?? 'specialist' });
        break;
      }
      case 'actions.requested':
        for (const action of Array.isArray(data.actions) ? data.actions : []) {
          const value = record(action);
          if (value?.kind === 'tool-call')
            upsert(value.callId, { tool: String(value.toolName), input: value.input });
        }
        break;
      case 'input.requested':
        for (const request of Array.isArray(data.requests) ? data.requests : []) {
          const value = record(request);
          const action = record(value?.action);
          if (!value || action?.kind !== 'tool-call') continue;
          upsert(action.callId, { tool: String(action.toolName), input: action.input });
          const requestId = String(value.requestId ?? value.id ?? action.callId);
          approvals.set(`${sessionId}:${requestId}`, {
            sessionId,
            requestId,
            kind: String(value.kind ?? 'unknown'),
            tool: String(action.toolName),
            callId: String(action.callId),
            input: action.input,
            prompt: text(value.prompt),
            resolution: approvals.get(`${sessionId}:${requestId}`)?.resolution ?? null,
          });
        }
        break;
      case 'input.resolved':
        for (const resolution of Array.isArray(data.resolutions) ? data.resolutions : []) {
          const value = record(resolution);
          if (!value) continue;
          const requestId = String(value.requestId ?? value.id);
          const existing = approvals.get(`${sessionId}:${requestId}`);
          const response = record(value.response);
          if (existing)
            existing.resolution = String(
              value.optionId ?? response?.optionId ?? value.outcome ?? 'resolved',
            );
        }
        break;
      case 'action.result': {
        const result = record(data.result);
        if (result?.kind !== 'tool-result') break;
        const status = data.status;
        upsert(result.callId, {
          tool: text(result.toolName) ?? undefined,
          output: result.output,
          status:
            status === 'completed' || status === 'failed' || status === 'rejected'
              ? status
              : 'pending',
          workingReceipt: isWorkingReceipt(data, result.output),
        });
        break;
      }
      case 'message.completed':
        session.finalMessage = text(data.message) ?? session.finalMessage;
        break;
      case 'turn.started':
        session.turn = 'running';
        break;
      case 'turn.completed':
        session.turn = 'completed';
        break;
      case 'turn.cancelled':
        session.turn = 'cancelled';
        break;
      case 'turn.failed':
      case 'step.failed':
      case 'session.failed':
        session.failures.push({
          code: String(data.code ?? type),
          message: String(data.message ?? 'failed'),
        });
        if (type !== 'step.failed') session.turn = 'failed';
        break;
      case 'session.waiting':
        if (session.turn === 'running') session.turn = 'waiting';
        break;
      case 'session.completed':
        if (session.turn === 'running' || session.turn === 'waiting') session.turn = 'completed';
        break;
    }
  }
  return { session, children };
}

export async function observeEve(
  rootSessionId: string,
  rootEvents: unknown[],
  readSession: SessionReader,
): Promise<EveObservation> {
  const calls = new Map<string, ObservedCall>();
  const approvals = new Map<string, ObservedApproval>();
  const sessions: ObservedSession[] = [];
  const root = scan(rootSessionId, null, 'orchestrator', rootEvents, calls, approvals);
  sessions.push(root.session);
  const pending = root.children.map((child) => ({ ...child, parent: rootSessionId }));
  const visited = new Set<string>([rootSessionId]);
  while (pending.length) {
    const child = pending.shift()!;
    if (visited.has(child.sessionId)) continue;
    visited.add(child.sessionId);
    // A child stream that cannot be read is an error, never "no calls".
    const events = await readSession(child.sessionId);
    const scanned = scan(child.sessionId, child.parent, child.name, events, calls, approvals);
    sessions.push(scanned.session);
    pending.push(...scanned.children.map((next) => ({ ...next, parent: child.sessionId })));
  }
  return {
    sessions,
    calls: [...calls.values()],
    approvals: [...approvals.values()],
    childProblems: sessions
      .filter(
        (session) =>
          session.parentSessionId !== null &&
          (session.turn !== 'completed' || session.failures.length > 0),
      )
      .map((session) => ({
        sessionId: session.sessionId,
        name: session.name,
        turn: session.turn,
        failures: session.failures,
      })),
    rootTurn: root.session.turn,
    finalMessage: root.session.finalMessage,
  };
}
export const completedCalls = (observation: EveObservation, tool: string) =>
  observation.calls.filter(
    (call) => call.tool === tool && call.status === 'completed' && !call.workingReceipt,
  );
