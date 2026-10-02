import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Rubric } from '#contracts/rubric';
import type { CaseResult } from '#contracts/result';
import {
  JudgeProfileSchema,
  JudgeScopeSchema,
  JudgeResponseSchema,
  SemanticReceiptSchema,
  type JudgeScope,
  type JudgeProfile,
  type JudgeRecord,
  type SemanticReceipt,
} from '#contracts/judge';
import type { NormalizedDocument } from '#src/documents/normalize';
import { readScoped, sha256, jsonText } from '#src/io';
import { stableJson } from '#src/environments/session';
import { redact } from '#src/config';
import { knownTokens } from '#src/harness/usage';
import { credentialSanitizer } from '#src/harness/adapters/base';
import { combineSemantic, inspectCalibration } from '#src/grading/adjudicate';
import { preflight, validateTask } from '#tasks/validate';
import { discover } from '#tasks/discover';
import { scanText } from '#fixtures/lint';

export const hashObject = (value: unknown) => sha256(stableJson(value));
export const JUDGE_SDK_VERSION = 'ai-7.0.123/openai-4.0.82/judge-chat-1.0.0';
const JUDGE_ENDPOINTS = Object.freeze({
  direct: 'https://api.openai.com/v1',
  gateway: 'https://ai-gateway.vercel.sh/v1',
});
// Review and its calibration link are excluded to avoid a circular approval hash.
// Every receipt additionally retains the full immutable profile fingerprint.
export function calibrationProfileHash(profile: JudgeProfile) {
  const { review, calibrationHash, ...configuration } = profile;
  return hashObject(configuration);
}
type SemanticCriterion = Extract<Rubric['criteria'][number], { method: 'semantic' }>;

function safeText(text: string, credentials: string[]) {
  if (
    redact(text) !== text ||
    credentials.some((key) => key && text.includes(key)) ||
    scanText(text).some((rule) => ['secret-pattern', 'credential-connection'].includes(rule)) ||
    /(?:api[_-]?key|password|secret|credential|DATABASE_URL)\s*[=:]\s*\S+|-----BEGIN .*PRIVATE KEY-----/i.test(
      text,
    )
  )
    throw new Error('JUDGE_SENSITIVE_DATA_DENIED');
  return text;
}

export async function scopeCriterion(
  criterion: SemanticCriterion,
  outputRoot: string,
  artifacts: CaseResult['artifacts'],
  documents: NormalizedDocument[],
  credentials: string[] = [],
): Promise<JudgeScope> {
  if (criterion.method !== 'semantic') throw new Error('JUDGE_NON_SEMANTIC_CRITERION');
  if (new Set(criterion.deliverables).size !== criterion.deliverables.length)
    throw new Error('JUDGE_DUPLICATE_DELIVERABLE');
  const deliverables = [];
  for (const file of criterion.deliverables) {
    const matches = artifacts.filter((artifact) => artifact.path === file);
    if (matches.length !== 1) throw new Error('JUDGE_DELIVERABLE_MISSING_OR_AMBIGUOUS');
    const bytes = await readScoped(outputRoot, file);
    if (sha256(bytes) !== matches[0]!.sha256) throw new Error('JUDGE_DELIVERABLE_CHANGED');
    deliverables.push({
      path: file,
      text: safeText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), credentials),
    });
  }
  const sources = [];
  const seen = new Set<string>();
  for (const reference of criterion.evidence) {
    const key = JSON.stringify([reference.sourceId, reference.locator]);
    if (seen.has(key)) throw new Error('JUDGE_DUPLICATE_SOURCE_POINTER');
    seen.add(key);
    const matches = documents.filter((document) => document.id === reference.sourceId);
    if (
      matches.length === 1 &&
      matches[0]!.extractHash !==
        sha256(jsonText({ units: matches[0]!.units, gaps: matches[0]!.gaps }))
    )
      throw new Error('JUDGE_SOURCE_EXTRACT_CHANGED');
    const units =
      matches.length === 1
        ? matches[0]!.units.filter((unit) => unit.locator === reference.locator)
        : [];
    if (units.length !== 1) throw new Error('JUDGE_SOURCE_MISSING_OR_AMBIGUOUS');
    const unit = units[0]!;
    // Formula and cached value are part of this unit's evidence, never neighboring units.
    const text = [
      unit.text,
      ...(unit.formula == null ? [] : [`Formula: ${unit.formula}`]),
      ...(unit.cachedValue == null ? [] : [`Cached value: ${unit.cachedValue}`]),
    ].join('\n');
    sources.push({
      sourceId: reference.sourceId,
      locator: reference.locator,
      text: safeText(text, credentials),
    });
  }
  return JudgeScopeSchema.parse({
    criterion: {
      id: criterion.id,
      title: safeText(criterion.title, credentials),
      passIf: safeText(criterion.passIf, credentials),
      failIf: safeText(criterion.failIf, credentials),
    },
    deliverables,
    sources,
  });
}

export function checkEvidence(scope: JudgeScope, evidence: JudgeRecord['evidence']) {
  for (const item of evidence) {
    const text =
      item.kind === 'deliverable'
        ? scope.deliverables.find((file) => file.path === item.ref && item.locator === 'text')?.text
        : scope.sources.find(
            (source) => source.sourceId === item.ref && source.locator === item.locator,
          )?.text;
    if (!item.quote.trim() || text === undefined || !text.includes(item.quote))
      throw new Error('JUDGE_EVIDENCE_NOT_IN_SCOPE');
  }
}

export function parseVerdict(raw: string, scope: JudgeScope) {
  const response = JudgeResponseSchema.parse(JSON.parse(raw));
  if (response.verdict !== 'error' && response.evidence.length === 0)
    throw new Error('JUDGE_EVIDENCE_MISSING');
  checkEvidence(scope, response.evidence);
  if (response.verdict === 'pass') {
    if (
      scope.deliverables.some(
        (file) =>
          !response.evidence.some((item) => item.kind === 'deliverable' && item.ref === file.path),
      ) ||
      scope.sources.some(
        (source) =>
          !response.evidence.some(
            (item) =>
              item.kind === 'source' &&
              item.ref === source.sourceId &&
              item.locator === source.locator,
          ),
      )
    )
      throw new Error('JUDGE_EVIDENCE_COVERAGE_MISSING');
  }
  return response;
}

function evaluation(raw: string | null, scope: JudgeScope | null, operationalError: string | null) {
  let rawVerdict: string | null = null;
  let rawExplanation: string | null = null;
  try {
    const object = JSON.parse(raw ?? 'null');
    rawVerdict = typeof object?.verdict === 'string' ? object.verdict : null;
    rawExplanation = typeof object?.explanation === 'string' ? object.explanation : null;
  } catch {
    /* Raw bytes remain inspectable even when JSON is malformed. */
  }
  try {
    if (operationalError) throw new Error(operationalError);
    if (raw === null || scope === null) throw new Error('JUDGE_EVIDENCE_UNAVAILABLE');
    return { ...parseVerdict(raw, scope), rawVerdict, rawExplanation };
  } catch (error) {
    return {
      verdict: 'error' as const,
      explanation:
        error instanceof SyntaxError
          ? 'JUDGE_MALFORMED_JSON'
          : error instanceof Error && error.name === 'ZodError'
            ? 'JUDGE_MALFORMED_SCHEMA'
            : String(error instanceof Error ? error.message : 'JUDGE_ERROR'),
      evidence: [],
      rawVerdict,
      rawExplanation,
    };
  }
}

function identity(
  receipt: Pick<SemanticReceipt, 'profileHash' | 'promptHash' | 'implementationHash' | 'runtime'>,
  judge: JudgeProfile['judges'][number],
) {
  const modelHash = hashObject({
    transport: judge.transport,
    model: judge.model,
    endpoint: JUDGE_ENDPOINTS[judge.transport],
    protocol: 'openai-chat-1.0.0',
  });
  return { modelHash, configurationFingerprint: hashObject({ ...receipt, judge }) };
}

export async function judgeImplementationHash() {
  return hashObject(
    await Promise.all(
      [
        new URL(import.meta.url),
        new URL('./adjudicate.js', import.meta.url),
        new URL('../contracts/judge.js', import.meta.url),
      ].map(async (url) => {
        // Source and built ESM have distinct fingerprints; neither silently migrates receipts.
        if (import.meta.url.endsWith('.ts')) url.pathname = url.pathname.replace(/\.js$/, '.ts');
        return sha256(await readFile(url));
      }),
    ),
  );
}

export interface JudgeOptions {
  profile: JudgeProfile;
  credentials?: Record<string, string>;
  allowPaid?: boolean;
  mode?: SemanticReceipt['mode'];
  fetch?: typeof globalThis.fetch;
  runtime: SemanticReceipt['runtime'];
  executionEvidenceHash: string;
  calibration?: { directory: string; file: string };
  readiness?: { root: string; suite: string };
}

export async function gradeSemantic(
  rubric: Rubric,
  deterministic: CaseResult,
  outputRoot: string,
  documents: NormalizedDocument[],
  options: JudgeOptions,
): Promise<SemanticReceipt> {
  const profile = JudgeProfileSchema.parse(options.profile);
  const mode = options.mode ?? 'benchmark';
  if (mode === 'offline-control') {
    if (!options.fetch) throw new Error('OFFLINE_TRANSPORT_REQUIRED');
  } else {
    if (!options.allowPaid) throw new Error('PAID_JUDGING_DISABLED');
    if (
      process.versions.node.split('.')[0] !== '24' ||
      options.runtime.nodeVersion !== process.version ||
      options.runtime.sdkVersion !== JUDGE_SDK_VERSION
    )
      throw new Error('JUDGE_RUNTIME_MISMATCH');
    if (options.fetch) throw new Error('CUSTOM_TRANSPORT_REQUIRES_OFFLINE_CONTROL');
    if (
      profile.purpose === 'release' &&
      mode !== 'calibration' &&
      (profile.review.status !== 'approved' || !profile.calibrationHash)
    )
      throw new Error('JUDGE_CALIBRATION_REVIEW_PENDING');
    if (profile.purpose === 'release' && mode !== 'calibration') {
      if (!options.calibration) throw new Error('JUDGE_CALIBRATION_EVIDENCE_MISSING');
      const bytes = await readScoped(options.calibration.directory, options.calibration.file);
      if (sha256(bytes) !== profile.calibrationHash)
        throw new Error('JUDGE_CALIBRATION_HASH_CHANGED');
      const calibration = await inspectCalibration(
        options.calibration.directory,
        JSON.parse(bytes.toString('utf8')),
        profile,
      );
      if (!calibration.ready) throw new Error('JUDGE_CALIBRATION_REVIEW_PENDING');
    }
  }
  if (rubric.taskId !== deterministic.taskId) throw new Error('JUDGE_TASK_IDENTITY_MISMATCH');
  if (mode !== 'offline-control') {
    if (!options.readiness) throw new Error('JUDGE_FULL_SUITE_PREFLIGHT_REQUIRED');
    const { root, suite } = options.readiness;
    const ready = await preflight(root, suite, true);
    if (!ready.valid || !ready.suite.cases.includes(rubric.taskId))
      throw new Error('JUDGE_FULL_SUITE_PREFLIGHT_FAILED');
    const entry = (await discover(root)).find((item) => item.task.id === rubric.taskId);
    if (!entry || entry.task.version !== deterministic.taskVersion)
      throw new Error('JUDGE_FROZEN_TASK_CHANGED');
    const current = await validateTask(root, entry.task);
    if (hashObject(current.rubric) !== hashObject(rubric))
      throw new Error('JUDGE_FROZEN_RUBRIC_CHANGED');
    for (const document of documents)
      if (
        !entry.task.inputs.some(
          (input) => input.id === document.id && input.sha256 === document.rawHash,
        )
      )
        throw new Error('JUDGE_UNDECLARED_SOURCE');
  }
  if (new Set(rubric.criteria.map((criterion) => criterion.id)).size !== rubric.criteria.length)
    throw new Error('JUDGE_DUPLICATE_CRITERION');
  const credentials = options.credentials ?? {};
  if (Object.keys(credentials).some((key) => !profile.judges.some((judge) => judge.id === key)))
    throw new Error('JUDGE_UNRELATED_CREDENTIAL');
  const prompt = await readFile(new URL('./prompts/criterion.txt', import.meta.url), 'utf8');
  const fingerprint = {
    profileHash: hashObject(profile),
    promptHash: sha256(prompt),
    implementationHash: await judgeImplementationHash(),
    runtime: options.runtime,
  };
  // Prepare the entire semantic selection before any API call. Failed scopes stay visible.
  const selected = [];
  for (const criterion of rubric.criteria.filter((item) => item.method === 'semantic')) {
    let scope: JudgeScope | null = null;
    let scopeError: string | null = null;
    try {
      scope = await scopeCriterion(
        criterion,
        outputRoot,
        deterministic.artifacts,
        documents,
        Object.values(credentials),
      );
    } catch (error) {
      scopeError = String(error instanceof Error ? error.message : 'JUDGE_SCOPE_ERROR');
    }
    selected.push({ criterionId: criterion.id, scope, scopeError });
  }
  const started = Date.now();
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let usageUnknown = false;
  const criteria: SemanticReceipt['criteria'] = [];
  for (const selection of selected) {
    const judges: JudgeRecord[] = [];
    for (const judge of profile.judges) {
      const requestStarted = Date.now();
      const evidenceHash = selection.scope ? hashObject(selection.scope) : null;
      const user = selection.scope ? stableJson(selection.scope) : null;
      const requestHash = user ? hashObject({ system: prompt, user }) : null;
      let operationalError = selection.scopeError;
      let rawResponse: string | null = null;
      let attempted = false;
      let input: number | null = 0;
      let output: number | null = 0;
      let cost: number | null = 0;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      try {
        if (operationalError) throw new Error(operationalError);
        if (!judge.model || !judge.pricing) throw new Error('JUDGE_CONFIGURATION_PENDING');
        const key = Object.hasOwn(credentials, judge.id) ? credentials[judge.id] : undefined;
        if (typeof key !== 'string' || !key) throw new Error('JUDGE_CREDENTIAL_MISSING');
        if (usageUnknown) throw new Error('JUDGE_USAGE_UNVERIFIED');
        const bytes = Buffer.byteLength(prompt) + Buffer.byteLength(user!);
        // UTF-8 bytes plus protocol overhead conservatively reserve input tokens.
        const inputReservation = bytes + 1024;
        const reservedCost =
          (inputReservation * judge.pricing.inputUsdPerMillion +
            profile.limits.maxOutputTokensPerRequest * judge.pricing.outputUsdPerMillion) /
          1_000_000;
        if (
          bytes > profile.limits.maxRequestBytes ||
          requests >= profile.limits.maxRequests ||
          inputTokens + inputReservation > profile.limits.maxInputTokens ||
          outputTokens + profile.limits.maxOutputTokensPerRequest >
            profile.limits.maxOutputTokens ||
          costUsd + reservedCost > profile.limits.maxCostUsd ||
          Date.now() - started >= profile.limits.maxDurationMs
        )
          throw new Error('JUDGE_BUDGET_EXHAUSTED');
        const timeoutMs = Math.min(
          profile.limits.timeoutMs,
          profile.limits.maxDurationMs - (Date.now() - started),
        );
        // Explicit endpoints avoid OPENAI_BASE_URL inheritance. Gateway's documented
        // chat endpoint avoids its native SDK's ambient Vercel project/o11y headers.
        const { createOpenAI } = await import('@ai-sdk/openai');
        const provider = createOpenAI({
          baseURL: JUDGE_ENDPOINTS[judge.transport],
          apiKey: key,
          ...(mode === 'offline-control' ? { fetch: options.fetch! } : {}),
        });
        const sanitize = credentialSanitizer(key);
        const { generateText } = await import('ai');
        const { reasoning, temperature, topP, seed } = judge.parameters;
        requests++;
        attempted = true;
        input = output = cost = null;
        const response = await Promise.race([
          generateText({
            model: provider.chat(judge.model),
            system: prompt,
            prompt: user!,
            ...(temperature === undefined ? {} : { temperature }),
            ...(topP === undefined ? {} : { topP }),
            ...(seed === undefined ? {} : { seed }),
            ...(reasoning === undefined ? {} : { reasoning }),
            maxRetries: 0,
            maxOutputTokens: profile.limits.maxOutputTokensPerRequest,
            abortSignal: controller.signal,
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new Error('JUDGE_TIMEOUT'));
            }, timeoutMs);
          }),
        ]);
        rawResponse = String(sanitize(response.text));
        input = knownTokens(response.usage.inputTokens);
        output = knownTokens(response.usage.outputTokens);
        cost =
          input === null || output === null
            ? null
            : (input * judge.pricing.inputUsdPerMillion +
                output * judge.pricing.outputUsdPerMillion) /
              1_000_000;
        if (input === null || output === null || cost === null)
          throw new Error('JUDGE_USAGE_UNVERIFIED');
        inputTokens += input;
        outputTokens += output;
        costUsd += cost;
        if (
          input > inputReservation ||
          output > profile.limits.maxOutputTokensPerRequest ||
          inputTokens > profile.limits.maxInputTokens ||
          outputTokens > profile.limits.maxOutputTokens ||
          costUsd > profile.limits.maxCostUsd
        )
          throw new Error('JUDGE_PROVIDER_BUDGET_EXCEEDED');
        if (rawResponse !== response.text) throw new Error('JUDGE_RESPONSE_SENSITIVE_DATA');
        if (
          response.finishReason !== 'stop' ||
          response.toolCalls.length ||
          response.warnings?.length
        )
          throw new Error('JUDGE_INCOMPLETE_OR_UNSUPPORTED_RESPONSE');
      } catch (error) {
        // Never retain provider error bodies: they may contain credentials or unrelated metadata.
        const message = error instanceof Error ? error.message : '';
        operationalError = /^JUDGE_[A-Z_]+$/.test(message) ? message : 'JUDGE_REQUEST_ERROR';
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      if (attempted && (input === null || output === null || cost === null)) usageUnknown = true;
      if (operationalError === 'JUDGE_PROVIDER_BUDGET_EXCEEDED') usageUnknown = true;
      judges.push({
        judgeId: judge.id,
        ...identity(fingerprint, judge),
        evidenceHash,
        requestHash,
        attempted,
        rawResponse,
        responseHash: rawResponse === null ? null : sha256(rawResponse),
        operationalError,
        ...evaluation(rawResponse, selection.scope, operationalError),
        usage: {
          inputTokens: input,
          outputTokens: output,
          costUsd: cost,
          durationMs: Date.now() - requestStarted,
        },
      });
    }
    criteria.push({
      ...selection,
      judges,
      disagreement: new Set(judges.map((judge) => judge.verdict)).size > 1,
    });
  }
  const receipt = SemanticReceiptSchema.parse({
    schemaVersion: '1.0.0',
    id: `judge-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    runId: deterministic.runId,
    taskId: deterministic.taskId,
    executionEvidenceHash: options.executionEvidenceHash,
    rubricHash: hashObject(rubric),
    deterministicHash: hashObject(deterministic),
    profile,
    prompt,
    ...fingerprint,
    mode,
    criteria,
    result: combineSemantic(rubric, deterministic, criteria),
  });
  return receipt;
}

// Pure replay: parses preserved responses and recomputes aggregation; imports no API client.
export function verifySemanticRecords(receipt: SemanticReceipt) {
  const fingerprint = {
    profileHash: receipt.profileHash,
    promptHash: receipt.promptHash,
    implementationHash: receipt.implementationHash,
    runtime: receipt.runtime,
  };
  if (
    receipt.profileHash !== hashObject(receipt.profile) ||
    receipt.promptHash !== sha256(receipt.prompt)
  )
    throw new Error('JUDGE_REPLAY_CONFIGURATION_CHANGED');
  if (
    new Set(receipt.criteria.map((criterion) => criterion.criterionId)).size !==
    receipt.criteria.length
  )
    throw new Error('JUDGE_REPLAY_COVERAGE_CHANGED');
  for (const criterion of receipt.criteria) {
    if (
      criterion.judges.length !== receipt.profile.judges.length ||
      (criterion.scope === null) !== (criterion.scopeError !== null)
    )
      throw new Error('JUDGE_REPLAY_COVERAGE_CHANGED');
    for (const [index, record] of criterion.judges.entries()) {
      const judge = receipt.profile.judges[index]!;
      const expected = identity(fingerprint, judge);
      if (
        record.judgeId !== judge.id ||
        record.modelHash !== expected.modelHash ||
        record.configurationFingerprint !== expected.configurationFingerprint ||
        record.evidenceHash !== (criterion.scope ? hashObject(criterion.scope) : null) ||
        record.requestHash !==
          (criterion.scope
            ? hashObject({ system: receipt.prompt, user: stableJson(criterion.scope) })
            : null) ||
        record.responseHash !== (record.rawResponse === null ? null : sha256(record.rawResponse))
      )
        throw new Error('JUDGE_REPLAY_RECORD_CHANGED');
      const evaluated = evaluation(record.rawResponse, criterion.scope, record.operationalError);
      if (
        hashObject(evaluated) !==
        hashObject({
          verdict: record.verdict,
          explanation: record.explanation,
          evidence: record.evidence,
          rawVerdict: record.rawVerdict,
          rawExplanation: record.rawExplanation,
        })
      )
        throw new Error('JUDGE_REPLAY_VERDICT_CHANGED');
      const usage = record.usage;
      if (
        !record.attempted &&
        (record.verdict !== 'error' ||
          record.rawResponse !== null ||
          usage.inputTokens !== 0 ||
          usage.outputTokens !== 0 ||
          usage.costUsd !== 0)
      )
        throw new Error('JUDGE_REPLAY_ATTEMPT_CHANGED');
      if (record.attempted) {
        const cost =
          usage.inputTokens === null || usage.outputTokens === null || !judge.pricing
            ? null
            : (usage.inputTokens * judge.pricing.inputUsdPerMillion +
                usage.outputTokens * judge.pricing.outputUsdPerMillion) /
              1_000_000;
        if (
          cost !== usage.costUsd ||
          (record.verdict !== 'error' &&
            (usage.inputTokens === null || usage.outputTokens === null || cost === null))
        )
          throw new Error('JUDGE_REPLAY_USAGE_UNVERIFIED');
      }
    }
    if (criterion.disagreement !== new Set(criterion.judges.map((judge) => judge.verdict)).size > 1)
      throw new Error('JUDGE_REPLAY_DISAGREEMENT_CHANGED');
  }
}

export function replaySemantic(
  value: unknown,
  rubric: Rubric,
  deterministic: CaseResult,
  executionEvidenceHash: string,
) {
  const receipt = SemanticReceiptSchema.parse(value);
  verifySemanticRecords(receipt);
  if (
    receipt.runId !== deterministic.runId ||
    receipt.taskId !== deterministic.taskId ||
    receipt.executionEvidenceHash !== executionEvidenceHash ||
    receipt.rubricHash !== hashObject(rubric) ||
    receipt.deterministicHash !== hashObject(deterministic) ||
    receipt.profileHash !== hashObject(receipt.profile) ||
    receipt.promptHash !== sha256(receipt.prompt)
  )
    throw new Error('JUDGE_REPLAY_IDENTITY_CHANGED');
  const selected = rubric.criteria.filter((criterion) => criterion.method === 'semantic');
  if (receipt.criteria.length !== selected.length) throw new Error('JUDGE_REPLAY_COVERAGE_CHANGED');
  for (const [index, criterion] of receipt.criteria.entries()) {
    const expected = selected[index]!;
    if (
      criterion.criterionId !== expected.id ||
      criterion.judges.length !== receipt.profile.judges.length ||
      (criterion.scope === null) !== (criterion.scopeError !== null)
    )
      throw new Error('JUDGE_REPLAY_COVERAGE_CHANGED');
    if (
      criterion.scope &&
      hashObject(criterion.scope.criterion) !==
        hashObject({
          id: expected.id,
          title: expected.title,
          passIf: expected.passIf,
          failIf: expected.failIf,
        })
    )
      throw new Error('JUDGE_REPLAY_STANDARD_CHANGED');
  }
  const result = combineSemantic(rubric, deterministic, receipt.criteria);
  if (hashObject(result) !== hashObject(receipt.result))
    throw new Error('JUDGE_REPLAY_RESULT_CHANGED');
  return { receipt, result };
}
