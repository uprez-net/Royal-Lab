import { ToolLoopAgent, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Task } from '#contracts/task';
import { ResultSchema, type CaseResult } from '#contracts/result';
import { TraceEventSchema, type TraceEvent } from '#contracts/trace';
import type { CandidateAdapter } from '#src/harness/adapters/base';
import { Usage, BudgetError, knownTokens, type Pricing } from '#src/harness/usage';
import { DOCUMENT_TOOL_SCHEMAS, type DocumentWorkspace } from '#src/environments/documents';
import { sha256, jsonText } from '#src/io';
import { stableJson } from '#src/environments/session';

const callId = (raw: string) => `call-${sha256(raw).slice(0, 24)}`;
export interface CandidateRunOptions {
  runId: string;
  trial?: number;
  task: Task;
  adapter: CandidateAdapter;
  workspace: DocumentWorkspace;
  saveDirectory: string;
  systemPrompt: string;
  pricing: Pricing;
  schemas?: Record<string, z.ZodType>;
  execute?: (name: string, args: unknown, call: string) => Promise<unknown>;
  executionProfile?: 'documents' | 'fixed-tools';
  attachTrace?: (emit: (event: Record<string, unknown>) => void) => void;
  afterExecution?: (
    name: string,
    result: unknown,
    call: string,
    emit: (event: Record<string, unknown>) => void,
  ) => void;
  committedEffects?: () => number;
  environmentFingerprint?: Record<string, unknown>;
  allowPaid?: boolean;
}
export async function runCandidate(options: CandidateRunOptions): Promise<CaseResult> {
  const { task, adapter } = options;
  if (adapter.executionMode !== 'offline-control' && !options.allowPaid)
    throw new Error('PAID_EXECUTION_DISABLED: explicit harness opt-in required');
  const json = (value: unknown): z.infer<typeof z.json> =>
    JSON.parse(JSON.stringify(adapter.sanitize(value)) ?? 'null');
  await mkdir(options.saveDirectory, { recursive: true });
  const traceFile = path.join(options.saveDirectory, 'trace.jsonl');
  await writeFile(traceFile, '', { flag: 'wx' });
  let sequence = 0;
  let writes: Promise<void> = Promise.resolve();
  const emit = (event: Record<string, unknown>) => {
    const parsed = TraceEventSchema.parse(
      adapter.sanitize({
        schemaVersion: '1.1.0',
        runId: options.runId,
        taskId: task.id,
        sequence: sequence++,
        at: new Date().toISOString(),
        ...event,
      }),
    );
    writes = writes.then(() => appendFile(traceFile, `${JSON.stringify(parsed)}\n`));
  };
  const usage = new Usage(task.limits, options.pricing);
  const operationCallId = (raw: string) => callId(`${usage.turns}:${raw}`);
  options.attachTrace?.(emit);
  const schemas: Record<string, z.ZodType> = options.schemas ?? DOCUMENT_TOOL_SCHEMAS;
  const tools: ToolSet = Object.create(null);
  const attempted = new Set<string>();
  let executions = 0;
  let invalidCall = false;
  let serial: Promise<unknown> = Promise.resolve();
  let providerDowngrade: string | null = null;
  for (const declared of task.tools) {
    const schema = Object.hasOwn(schemas, declared.name) ? schemas[declared.name] : undefined;
    if (!schema) throw new Error(`TOOL_UNIMPLEMENTED: ${declared.name}`);
    tools[declared.name] = tool({
      description: `${declared.name}: case-scoped evidence or declared output only`,
      inputSchema: schema,
      execute: async (input, context) => {
        const id = operationCallId(context.toolCallId);
        const operation = async () => {
          if (!attempted.has(id)) {
            attempted.add(id);
            usage.toolAttempts++;
            emit({ type: 'tool-attempt', callId: id, tool: declared.name, arguments: json(input) });
          }
          usage.check();
          if (usage.toolAttempts > task.limits.maxToolCalls)
            throw new BudgetError('Tool-call budget exhausted');
          try {
            executions++;
            const result = await (options.execute
              ? options.execute(declared.name, input, id)
              : options.workspace.execute(declared.name, input));
            emit({
              type: 'tool-executed',
              callId: id,
              tool: declared.name,
              outcome: 'success',
              result: json(result),
            });
            options.afterExecution?.(declared.name, result, id, emit);
            return result;
          } catch (error) {
            const reason = String(adapter.sanitize(error instanceof Error ? error.message : error));
            emit({
              type: 'tool-executed',
              callId: id,
              tool: declared.name,
              outcome: /APPROVAL_|DENIED/.test(reason)
                ? 'blocked'
                : reason.includes('DOMAIN_REFUSAL')
                  ? 'domain-refusal'
                  : 'error',
              result: { error: reason },
            });
            if (error instanceof BudgetError) throw error;
            return { error: reason };
          }
        };
        const result = serial.then(operation);
        serial = result.catch(() => {});
        return result;
      },
    });
  }
  const brief = {
    id: task.id,
    title: task.title,
    instruction: task.instruction,
    clock: task.clock,
    jurisdiction: task.jurisdiction,
    currency: task.currency,
    files: options.workspace
      .snapshot()
      .map((doc) => ({ id: doc.id, path: doc.path, units: doc.units.length, gaps: doc.gaps })),
    deliverables: task.deliverables,
  };
  const fingerprint = {
    schemaVersion: '1.1.0',
    taskId: task.id,
    provider: adapter.provider,
    model: adapter.modelId,
    transport: adapter.transport,
    executionMode: adapter.executionMode,
    sdkVersion: adapter.sdkVersion,
    callIdentityVersion: 'turn-provider-call-1.0.0',
    parameters: adapter.parameters,
    promptHash: sha256(options.systemPrompt),
    toolSchemaHash: sha256(
      stableJson(
        Object.fromEntries(
          Object.entries(schemas)
            .filter(([name]) => task.tools.some((tool) => tool.name === name))
            .map(([name, schema]) => [name, z.toJSONSchema(schema)]),
        ),
      ),
    ),
    limits: task.limits,
    pricing: options.pricing,
    taskHash: sha256(stableJson(task)),
    rubricHash: task.rubricHash,
    fixtureHash: task.fixtureHash,
    provenanceHash: task.provenanceHash,
    environment: options.environmentFingerprint ?? {},
    parserHashes: options.workspace.snapshot().map((doc) => ({
      source: doc.id,
      rawHash: doc.rawHash,
      parserHash: doc.parserHash,
      extractHash: doc.extractHash,
    })),
  };
  await writeFile(
    path.join(options.saveDirectory, 'configuration.json'),
    jsonText({ ...fingerprint, configurationHash: sha256(stableJson(fingerprint)) }),
    { flag: 'wx' },
  );
  await writeFile(path.join(options.saveDirectory, 'prompt.txt'), options.systemPrompt, {
    flag: 'wx',
  });
  const documentsText = jsonText(options.workspace.snapshot());
  try {
    await writeFile(path.join(options.saveDirectory, 'documents.json'), documentsText, {
      flag: 'wx',
    });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
      sha256(await readFile(path.join(options.saveDirectory, 'documents.json'))) !==
        sha256(documentsText)
    )
      throw error;
  }
  let status: CaseResult['status'] = 'completed';
  let reason: string | null = null;
  let artifacts: CaseResult['artifacts'] = [];
  const maxStepOutput = Math.min(task.limits.maxOutputTokens, 4000);
  const agent = new ToolLoopAgent({
    model: adapter.model,
    instructions: options.systemPrompt,
    tools,
    ...(adapter.parameters.temperature === undefined
      ? {}
      : { temperature: adapter.parameters.temperature }),
    ...(adapter.parameters.topP === undefined ? {} : { topP: adapter.parameters.topP }),
    ...(adapter.parameters.seed === undefined ? {} : { seed: adapter.parameters.seed }),
    ...(adapter.parameters.reasoning === undefined
      ? {}
      : { reasoning: adapter.parameters.reasoning }),
    maxOutputTokens: maxStepOutput,
    maxRetries: 0,
    timeout: task.limits.maxDurationMs,
    stopWhen: ({ steps }) =>
      steps.length >= task.limits.maxTurns ||
      invalidCall ||
      usage.toolAttempts >= task.limits.maxToolCalls,
    prepareStep: () => {
      if (providerDowngrade) throw new Error(providerDowngrade);
      const output = Math.min(
        maxStepOutput,
        Math.max(1, task.limits.maxOutputTokens - (usage.outputTokens ?? 0)),
      );
      usage.beforeRequest(output);
      return { maxOutputTokens: output };
    },
    onLanguageModelCallStart: (event) => {
      usage.requestsStarted++;
      emit({
        type: 'model-request',
        requestId: callId(event.callId),
        provider: event.provider,
        model: event.modelId,
        request: json(event),
      });
    },
    onLanguageModelCallEnd: (event) => {
      usage.add(event.usage);
      emit({
        type: 'model-response',
        requestId: callId(event.callId),
        response: json(event),
        inputTokens: knownTokens(event.usage.inputTokens),
        outputTokens: knownTokens(event.usage.outputTokens),
        finishReason: event.finishReason,
      });
      for (const content of event.content) {
        if (content.type === 'tool-call') {
          const id = operationCallId(content.toolCallId);
          if (!attempted.has(id)) {
            attempted.add(id);
            usage.toolAttempts++;
            emit({
              type: 'tool-attempt',
              callId: id,
              tool: /^[a-zA-Z0-9][\w.-]*$/.test(content.toolName)
                ? content.toolName
                : `unknown-${sha256(content.toolName).slice(0, 8)}`,
              arguments: json(
                Object.hasOwn(schemas, content.toolName) &&
                  schemas[content.toolName]?.safeParse(content.input).success
                  ? schemas[content.toolName]!.parse(content.input)
                  : content.input,
              ),
            });
          }
          if (
            !tools[content.toolName] ||
            !Object.hasOwn(schemas, content.toolName) ||
            !schemas[content.toolName]?.safeParse(content.input).success
          )
            invalidCall = true;
        }
        if (content.type === 'text')
          emit({ type: 'candidate', text: content.text, providerFinishReason: event.finishReason });
      }
      usage.check();
    },
    onStepEnd: (event) => {
      if (event.warnings && event.warnings.length > 0)
        providerDowngrade = `PROVIDER_DOWNGRADE: ${JSON.stringify(event.warnings)}`;
    },
  });
  try {
    const result = await agent.generate({ prompt: jsonText(brief) });
    await serial;
    usage.check();
    if (providerDowngrade) throw new Error(providerDowngrade);
    if (invalidCall) throw new Error('CANDIDATE_INVALID_TOOL_CALL');
    if (
      result.finishReason === 'length' ||
      usage.turns >= task.limits.maxTurns ||
      usage.toolAttempts >= task.limits.maxToolCalls
    )
      throw new BudgetError('Candidate turn/tool/output exhaustion');
    if (usage.inputTokens === null || usage.outputTokens === null || usage.costUsd === null)
      throw new Error('USAGE_UNVERIFIED');
    artifacts = await options.workspace.artifacts();
  } catch (error) {
    await serial.catch(() => {});
    reason = String(adapter.sanitize(error instanceof Error ? error.message : error));
    status =
      error instanceof BudgetError
        ? 'budget-exhausted'
        : /OUTPUT_|CANDIDATE_/.test(reason)
          ? 'candidate-failure'
          : 'infrastructure-error';
    try {
      artifacts = await options.workspace.artifacts(false);
    } catch {}
  }
  emit({ type: 'termination', status, reason });
  usage.reconcileUnansweredRequests();
  await writes;
  const result = ResultSchema.parse({
    schemaVersion: '1.1.0',
    runId: options.runId,
    taskId: task.id,
    taskVersion: task.version,
    profile: options.executionProfile ?? 'documents',
    trial: options.trial ?? 0,
    status,
    reason,
    gradingStatus: 'ungraded',
    strictSuccess: false,
    criticalGatesPassed: null,
    criteria: [],
    outcomeId: null,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      candidateCostUsd: usage.costUsd,
      judgeCostUsd: null,
      durationMs: Date.now() - usage.started,
      toolAttempts: usage.toolAttempts,
      toolExecutions: executions,
      committedEffects: options.committedEffects?.() ?? 0,
    },
    artifacts,
  });
  await writeFile(path.join(options.saveDirectory, 'result.json'), jsonText(result), {
    flag: 'wx',
  });
  await writeFile(
    path.join(options.saveDirectory, 'execution-receipt.json'),
    jsonText({
      schemaVersion: '1.0.0',
      runId: options.runId,
      resultHash: sha256(jsonText(result)),
      traceHash: sha256(await readFile(traceFile)),
      documentsHash: sha256(documentsText),
      configurationHash: sha256(
        await readFile(path.join(options.saveDirectory, 'configuration.json')),
      ),
      promptHash: sha256(options.systemPrompt),
    }),
    { flag: 'wx' },
  );
  return result;
}
