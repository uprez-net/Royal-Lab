import { randomUUID } from 'node:crypto';
import {
  EveRunRecordSchema,
  EveTargetEvidenceSchema,
  type EveCase,
  type EveDeployment,
  type EveRunRecord,
  type EveTargetEvidence,
} from '#contracts/eve';
import { redact } from '#src/config';
import { sha256 } from '#src/io';
import { stableJson } from '#src/environments/session';
import { observeEve, type EveObservation } from '#src/harness/adapters/eve-events';

// Client for the existing Royal Eve staging flow: the preview-only evaluator
// bootstrap mints a short-lived token for the dedicated eval user, and the
// benchmark then drives the normal /eve/v1/session routes. The evaluator holds
// only the shared bootstrap secret and the target URL: never a database or
// Clerk secret, and there is no direct bearer bypass in this path.
export const EVAL_AUTH_HEADER = 'x-eval-auth-secret';
export const EVAL_SESSION_HEADER = 'x-eval-session-id';

export class CredentialExpiredError extends Error {}
export class EveTargetError extends Error {}

// HTTPS only, no embedded credentials, and an explicit host allow-list: a
// typo cannot point a live write run at whatever resolves.
export function validateTarget(raw: string, stagingHost: string | null) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EveTargetError('EVE_TARGET_INVALID: the staging target must be a URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new EveTargetError('EVE_TARGET_INVALID: HTTPS without embedded credentials required');
  if (stagingHost ? url.hostname !== stagingHost : !url.hostname.endsWith('.vercel.app'))
    throw new EveTargetError(
      stagingHost
        ? 'EVE_TARGET_NOT_ALLOWED: host is not the configured staging host'
        : 'EVE_TARGET_NOT_ALLOWED: only *.vercel.app previews without an explicit staging host',
    );
  return new URL(url.origin);
}
const sessionIdFromJwt = (token: string) => {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    return typeof payload.sid === 'string' ? payload.sid : null;
  } catch {
    return null;
  }
};

export interface RoyalEveClientOptions {
  target: string;
  stagingHost: string | null;
  // Resolved lazily from the explicitly named variable; never logged or saved.
  secret: () => string;
  deployment: EveDeployment;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
export class RoyalEveClient {
  readonly origin: URL;
  private token: string | null = null;
  private expiresAt = 0;
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  refreshes = 0;
  evidence: EveTargetEvidence | null = null;
  get deployment() {
    return this.options.deployment;
  }
  constructor(private readonly options: RoyalEveClientOptions) {
    this.origin = validateTarget(options.target, options.stagingHost);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  private url(path: string) {
    return new URL(path, this.origin);
  }
  async bootstrap(): Promise<EveTargetEvidence> {
    const response = await this.fetch(this.url('/api/eval/auth'), {
      method: 'POST',
      cache: 'no-store',
      headers: { [EVAL_AUTH_HEADER]: this.options.secret() },
    });
    if (!response.ok)
      throw new EveTargetError(
        `EVE_BOOTSTRAP_HTTP_${response.status}: ${response.status === 404 ? 'bootstrap disabled (not an opted-in preview)' : response.status === 401 ? 'shared secret mismatch' : 'refused'}`,
      );
    const body = (await response.json()) as Record<string, unknown>;
    const { deployment } = this.options;
    // A token minted for a refused target is revoked at once, never left live.
    const refuse = async (message: string): Promise<never> => {
      if (typeof body.token === 'string') await this.revoke(body.token);
      throw new EveTargetError(message);
    };
    if (
      typeof body.token !== 'string' ||
      body.environment !== 'preview' ||
      typeof body.expiresInSeconds !== 'number' ||
      body.expiresInSeconds > deployment.tokenTtlSeconds
    )
      await refuse('EVE_BOOTSTRAP_INVALID: not a short-lived preview evaluator token');
    for (const flag of deployment.requiredFlags)
      if (body[flag] !== true) await refuse(`EVE_FLAG_DISABLED: ${flag}`);
    if (body.databaseLabel !== deployment.databaseLabel)
      await refuse(
        `EVE_WRONG_DATABASE: target reports ${JSON.stringify(body.databaseLabel)}, profile pins ${JSON.stringify(deployment.databaseLabel)}`,
      );
    if (body.fixtureVersion !== deployment.fixtureVersion)
      await refuse(
        `EVE_FIXTURE_VERSION_MISMATCH: target reports ${JSON.stringify(body.fixtureVersion)}, profile pins ${JSON.stringify(deployment.fixtureVersion)}`,
      );
    if (deployment.deploymentHost && body.deployment !== deployment.deploymentHost)
      await refuse(
        `EVE_DEPLOYMENT_MISMATCH: target reports deployment ${JSON.stringify(body.deployment)}, pinned ${JSON.stringify(deployment.deploymentHost)}`,
      );
    const token = body.token as string;
    const expiresInSeconds = body.expiresInSeconds as number;
    const previous = this.token;
    this.token = token;
    this.expiresAt = this.now() + expiresInSeconds * 1000;
    if (previous) {
      this.refreshes++;
      await this.revoke(previous);
    }
    const info = await this.authorized('/eve/v1/info', { method: 'GET' });
    const infoBody = (await info.json()) as { kind?: unknown; version?: unknown };
    if (infoBody.kind !== 'eve-agent-info' || infoBody.version !== deployment.infoVersion)
      throw new EveTargetError(
        `EVE_INFO_MISMATCH: target reports ${JSON.stringify({ kind: infoBody.kind, version: infoBody.version })}, profile pins version ${deployment.infoVersion}`,
      );
    this.evidence = EveTargetEvidenceSchema.parse({
      origin: this.origin.origin,
      environment: 'preview',
      deployment: typeof body.deployment === 'string' ? body.deployment : null,
      databaseLabel: body.databaseLabel,
      fixtureVersion: body.fixtureVersion,
      operationsAgentEnabled: body.operationsAgentEnabled === true,
      specialistsEnabled: body.specialistsEnabled === true,
      infoKind: infoBody.kind,
      infoVersion: infoBody.version,
      checkedAt: new Date(this.now()).toISOString(),
    });
    return this.evidence;
  }
  // Refresh before expiry; an expired credential is an infrastructure outcome.
  private async authorized(path: string, init: RequestInit): Promise<Response> {
    if (!this.token) throw new CredentialExpiredError('EVE_NOT_BOOTSTRAPPED');
    if (this.expiresAt - this.now() < this.options.deployment.refreshMarginSeconds * 1000)
      await this.bootstrap();
    const response = await this.fetch(this.url(path), {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (response.status === 401 || response.status === 403)
      throw new CredentialExpiredError(`EVE_CREDENTIAL_REJECTED: HTTP ${response.status}`);
    return response;
  }
  private async post(path: string, body: unknown) {
    const response = await this.authorized(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok || json.ok !== true)
      throw new Error(
        `EVE_SESSION_HTTP_${response.status}: ${String(json.code ?? json.error ?? '')}`,
      );
    return json;
  }
  async createSession(message: string) {
    const json = await this.post('/eve/v1/session', { message });
    if (typeof json.sessionId !== 'string') throw new Error('EVE_SESSION_ID_MISSING');
    return json.sessionId;
  }
  // Continue the same session for clarifications and approvals.
  async send(sessionId: string, message: string) {
    await this.post(`/eve/v1/session/${encodeURIComponent(sessionId)}`, { message });
  }
  async respond(
    sessionId: string,
    requestId: string,
    tool: string,
    optionId: 'approve' | 'cancel',
  ) {
    // Never-approve operations are refused before the request leaves this machine.
    if (optionId === 'approve' && this.options.deployment.neverApprove.includes(tool))
      throw new Error(`EVE_NEVER_APPROVE: ${tool} is cancelled on staging`);
    await this.post(`/eve/v1/session/${encodeURIComponent(sessionId)}`, {
      inputResponses: [{ requestId, optionId }],
    });
  }
  // Catch-up read to the durable tail; a missing tail index is an error, not "no events".
  async readSession(sessionId: string): Promise<unknown[]> {
    const response = await this.authorized(
      `/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0&includeTailIndex=1`,
      { method: 'GET' },
    );
    if (!response.ok) throw new Error(`EVE_STREAM_HTTP_${response.status}: ${sessionId}`);
    const header = response.headers.get('x-eve-stream-tail-index');
    const tail = header === null || header.trim() === '' ? Number.NaN : Number(header);
    if (!Number.isInteger(tail) || tail < -1)
      throw new Error(`EVE_STREAM_TAIL_INVALID: ${sessionId}`);
    const events = (await response.text())
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
    if (events.length <= tail) throw new Error(`EVE_STREAM_TRUNCATED: ${sessionId}`);
    return events.slice(0, tail + 1);
  }
  // Wait until the session parks or ends after `after` events.
  async waitForBoundary(sessionId: string, after: number, timeoutMs: number) {
    const deadline = this.now() + timeoutMs;
    for (;;) {
      const events = await this.readSession(sessionId);
      const fresh = events.slice(after) as { type?: string }[];
      if (
        fresh.some((event) =>
          ['session.waiting', 'session.completed', 'session.failed'].includes(event.type ?? ''),
        )
      )
        return events;
      if (this.now() >= deadline) throw new Error(`EVE_TURN_TIMEOUT: ${sessionId}`);
      await this.sleep(1000);
    }
  }
  async observe(sessionId: string): Promise<EveObservation> {
    return observeEve(sessionId, await this.readSession(sessionId), (child) =>
      this.readSession(child),
    );
  }
  private async revoke(token: string) {
    const session = sessionIdFromJwt(token);
    if (!session) return;
    await this.fetch(this.url('/api/eval/auth/revoke'), {
      method: 'POST',
      cache: 'no-store',
      headers: { [EVAL_AUTH_HEADER]: this.options.secret(), [EVAL_SESSION_HEADER]: session },
    }).catch(() => undefined);
  }
  async close() {
    if (this.token) await this.revoke(this.token);
    this.token = null;
  }
}

export interface EveCaseRun {
  record: EveRunRecord;
  observation: EveObservation | null;
}
// Drive one supported case: start, continue the same session for the approval
// decision, then observe every session recursively. The evaluator never decides
// success here; grading needs the observation plus imported durable evidence.
export async function runEveCase(
  client: RoyalEveClient,
  item: EveCase,
  options: {
    runId?: string;
    profileVersion: string;
    labels: Record<string, string | undefined>;
    turnTimeoutMs: number;
    now?: () => Date;
  },
): Promise<EveCaseRun> {
  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? `eve-${randomUUID()}`;
  const startedAt = now().toISOString();
  const marker = item.kind === 'approved-write' ? `EVE-EVAL-${runId}` : null;
  let rootSessionId: string | null = null;
  let observation: EveObservation | null = null;
  let outcome: EveRunRecord['outcome'] = 'completed';
  let reason: string | null = null;
  const deploymentHash = sha256(stableJson(client.deployment));
  try {
    const label = options.labels[item.fixtureLabelEnv];
    if (!label)
      throw Object.assign(new Error(`EVE_FIXTURE_LABEL_UNSET: ${item.fixtureLabelEnv}`), {
        blocked: true,
      });
    if (!client.evidence) await client.bootstrap();
    const prompt = item.prompt.replaceAll('{label}', label).replaceAll('{marker}', marker ?? '');
    rootSessionId = await client.createSession(prompt);
    let events = await client.waitForBoundary(rootSessionId, 0, options.turnTimeoutMs);
    observation = await client.observe(rootSessionId);
    const pending = observation.approvals.filter(
      (approval) => approval.sessionId === rootSessionId && approval.resolution === null,
    );
    for (const approval of pending) {
      const decision =
        item.kind === 'approved-write' && approval.tool === item.tool ? 'approve' : 'cancel';
      await client.respond(rootSessionId, approval.requestId, approval.tool, decision);
      events = await client.waitForBoundary(rootSessionId, events.length, options.turnTimeoutMs);
    }
    observation = await client.observe(rootSessionId);
  } catch (error) {
    reason = String(redact(error instanceof Error ? error.message : error));
    outcome =
      error instanceof CredentialExpiredError
        ? 'credential-expired'
        : (error as { blocked?: boolean }).blocked || error instanceof EveTargetError
          ? 'blocked-input'
          : 'infrastructure-error';
  }
  const record = EveRunRecordSchema.parse({
    schemaVersion: '1.0.0',
    runId,
    caseId: item.id,
    profileVersion: options.profileVersion,
    deploymentHash,
    marker,
    target: client.evidence ?? {
      origin: client.origin.origin,
      environment: 'preview',
      deployment: null,
      databaseLabel: null,
      fixtureVersion: null,
      operationsAgentEnabled: false,
      specialistsEnabled: false,
      infoKind: 'not-checked',
      infoVersion: 0,
      checkedAt: startedAt,
    },
    rootSessionId,
    outcome,
    reason,
    credentialRefreshes: client.refreshes,
    startedAt,
    finishedAt: now().toISOString(),
  });
  return { record, observation };
}
