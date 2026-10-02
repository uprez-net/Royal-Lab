import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { directAdapter } from '#src/harness/adapters/direct';
import { gatewayAdapter } from '#src/harness/adapters/gateway';
import { runCandidate } from '#src/harness/loop';
import { DocumentWorkspace } from '#src/environments/documents';
import { discover } from '#tasks/discover';
import { validateArtifact } from '#tasks/validate';
import { RubricSchema } from '#contracts/rubric';
import { VerificationPlanSchema } from '#src/grading/verification';
import { readJson, sha256, jsonText } from '#src/io';
import { stableJson } from '#src/environments/session';
import { regradeSaved } from '#runs/regrade';
import { JudgeProfileSchema } from '#contracts/judge';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const pricing = {
  version: 'offline-test-1',
  asOf: '2026-10-01T00:00:00Z',
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 2,
};
type Mode =
  | 'correct'
  | 'unknown'
  | 'prototype-name'
  | 'malformed'
  | 'missing'
  | 'unknown-usage'
  | 'provider-error'
  | 'partial'
  | 'reused-id';
async function run(
  transport: 'direct' | 'gateway',
  mode: Mode = 'correct',
  maxTurns = 8,
  offlineControl = true,
) {
  const root = process.cwd();
  await mkdir(path.join(root, 'tmp'), { recursive: true });
  const directory = await mkdtemp(path.join(root, 'tmp/candidate-'));
  directories.push(directory);
  const task = structuredClone(
    (await discover(root)).find((item) => item.task.definitionId === 'D01')!.task,
  );
  task.limits.maxTurns = maxTurns;
  let requests = 0;
  const mockFetch: typeof fetch = async (input, init) => {
    assert.ok(
      String(input).includes(transport === 'direct' ? '/chat/completions' : '/language-model'),
    );
    assert.ok(init?.body);
    const first = requests++ === 0;
    if (mode === 'provider-error')
      return new Response(
        JSON.stringify({
          error: { message: 'Rejected explicit key offline-test-key', type: 'server_error' },
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    const calls =
      mode === 'unknown'
        ? [{ name: 'steal_secrets', args: '{}' }]
        : mode === 'prototype-name'
          ? [{ name: 'constructor', args: '{}' }]
          : mode === 'malformed'
            ? [{ name: 'write', args: '{invalid' }]
            : mode === 'missing'
              ? []
              : [
                  {
                    name: 'write',
                    args: JSON.stringify({
                      path: 'facts.json',
                      content:
                        '{"costBaseCents":51200000,"overheadCents":5120000,"feeCents":4096000,"contractCents":66457600}',
                    }),
                  },
                  {
                    name: 'write',
                    args: JSON.stringify({
                      path: 'review.md',
                      content:
                        'Contract total AUD $664,576 [source json:/quote/contractCents]. Additive fee/overhead; review current quote.',
                    }),
                  },
                ];
    if (mode === 'partial') calls.splice(1);
    const toolCalls = (first || (mode === 'reused-id' && requests === 2)) && calls.length > 0;
    const body =
      transport === 'direct'
        ? {
            id: `mock-${requests}`,
            object: 'chat.completion',
            created: 1,
            model: 'mock-direct',
            choices: [
              {
                index: 0,
                finish_reason: toolCalls ? 'tool_calls' : 'stop',
                message: {
                  role: 'assistant',
                  content: toolCalls ? null : 'Saved the review artifacts.',
                  ...(toolCalls
                    ? {
                        tool_calls: calls.map((call, index) => ({
                          id: `tc-${index}`,
                          type: 'function',
                          function: { name: call.name, arguments: call.args },
                        })),
                      }
                    : {}),
                },
              },
            ],
            ...(mode === 'unknown-usage'
              ? {}
              : { usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }),
          }
        : {
            content: toolCalls
              ? calls.map((call, index) => ({
                  type: 'tool-call',
                  toolCallId: `tc-${index}`,
                  toolName: call.name,
                  input: call.args,
                }))
              : [{ type: 'text', text: 'Saved the review artifacts.' }],
            finishReason: {
              unified: toolCalls ? 'tool-calls' : 'stop',
              raw: toolCalls ? 'tool_calls' : 'stop',
            },
            usage: {
              inputTokens: {
                total: mode === 'unknown-usage' ? undefined : 50,
                noCache: 50,
                cacheRead: 0,
              },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
            response: {
              id: `mock-${requests}`,
              modelId: 'mock-gateway',
              timestamp: '2026-10-01T00:00:00Z',
            },
            warnings: [],
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const adapterOptions = {
    offlineControl,
    model: transport === 'direct' ? 'mock-direct' : 'mock/provider-model',
    apiKey: 'offline-test-key',
    fetch: mockFetch,
  };
  const adapter = await (transport === 'direct'
    ? directAdapter(adapterOptions)
    : gatewayAdapter(adapterOptions));
  const saveDirectory = path.join(directory, 'evidence');
  await mkdir(saveDirectory);
  const workspace = await DocumentWorkspace.create(root, task, path.join(saveDirectory, 'outputs'));
  const rubric = RubricSchema.parse(
    await readJson(path.join(root, `tasks/${task.id}`, task.rubricPath)),
  );
  const verification = VerificationPlanSchema.parse(
    await readJson(path.join(root, `tasks/${task.id}`, 'grading/verification.json')),
  );
  const snapshot = {
    task,
    rubric,
    verification,
    taskHash: sha256(stableJson(task)),
    rubricHash: sha256(jsonText(rubric)),
    sourceRubricHash: task.rubricHash,
    sourceVerificationHash: task.verificationHash,
    verificationHash: sha256(jsonText(verification)),
  };
  await writeFile(path.join(saveDirectory, 'grading-inputs.json'), jsonText(snapshot));
  const result = await runCandidate({
    runId: 'offline-control',
    task,
    adapter,
    workspace,
    saveDirectory,
    pricing,
    systemPrompt: await readFile('src/harness/prompts/documents.txt', 'utf8'),
    environmentFingerprint: { gradingInputsHash: sha256(jsonText(snapshot)) },
  });
  return { result, directory, requests, saveDirectory };
}
test.each(['direct', 'gateway'] as const)(
  '%s adapter runs the same task through the real SDK with an offline mock transport',
  async (transport) => {
    const { result, requests, saveDirectory } = await run(transport);
    assert.equal(result.status, 'completed', result.reason ?? 'no reason');
    assert.equal(result.strictSuccess, false);
    assert.equal(result.gradingStatus, 'ungraded');
    assert.equal(requests, 2);
    assert.equal(result.artifacts.length, 2);
    assert.equal(result.usage.toolAttempts, 2);
    await validateArtifact(path.join(saveDirectory, 'trace.jsonl'), 'trace');
    await validateArtifact(path.join(saveDirectory, 'result.json'), 'result');
    const config = JSON.parse(
      await readFile(path.join(saveDirectory, 'configuration.json'), 'utf8'),
    );
    assert.match(config.configurationHash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(config).includes('offline-test-key'));
  },
);
test.each(['unknown', 'prototype-name', 'malformed', 'missing'] as const)(
  '%s candidate output cannot produce successful execution',
  async (mode) => {
    const { result } = await run('direct', mode);
    assert.equal(result.status, 'candidate-failure', result.reason ?? '');
    assert.equal(result.strictSuccess, false);
  },
);
test('unknown usage remains null and prevents further paid requests', async () => {
  const { result, requests } = await run('direct', 'unknown-usage');
  assert.equal(result.status, 'infrastructure-error');
  assert.equal(result.usage.inputTokens, null);
  assert.equal(result.usage.candidateCostUsd, null);
  assert.equal(requests, 1);
});
test('the low-level harness also requires explicit paid opt-in and offline controls require a supplied mock transport', async () => {
  await assert.rejects(run('direct', 'correct', 8, false), /PAID_EXECUTION_DISABLED/);
  await assert.rejects(
    directAdapter({ model: 'mock-only', apiKey: 'offline-test-key', offlineControl: true }),
    /OFFLINE_TRANSPORT_REQUIRED/,
  );
});
test('a failed provider request has unknown usage/cost and retains only sanitized diagnostics', async () => {
  const { result, requests, saveDirectory } = await run('direct', 'provider-error');
  assert.equal(requests, 1);
  assert.equal(result.status, 'infrastructure-error');
  assert.equal(result.usage.inputTokens, null);
  assert.equal(result.usage.candidateCostUsd, null);
  assert.ok(!JSON.stringify(result).includes('offline-test-key'));
  assert.ok(
    !(await readFile(path.join(saveDirectory, 'trace.jsonl'), 'utf8')).includes('offline-test-key'),
  );
});
test('candidate loop exhaustion retains its artifacts and trace with an explicit failure', async () => {
  const { result } = await run('direct', 'correct', 1);
  assert.equal(result.status, 'budget-exhausted');
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.strictSuccess, false);
});
test('a provider reusing a raw call ID in a new turn receives a distinct operation identity', async () => {
  const { result, saveDirectory, requests } = await run('direct', 'reused-id');
  assert.equal(result.status, 'completed', result.reason ?? '');
  assert.equal(requests, 3);
  assert.equal(result.usage.toolAttempts, 4);
  assert.equal(result.usage.toolExecutions, 4);
  const events = (await readFile(path.join(saveDirectory, 'trace.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(
    new Set(events.filter((event) => event.type === 'tool-attempt').map((event) => event.callId))
      .size,
    4,
  );
  await validateArtifact(path.join(saveDirectory, 'trace.jsonl'), 'trace');
});
test('a missing deliverable fails execution but preserves hashes of partial output for offline inspection', async () => {
  const { result } = await run('direct', 'partial');
  assert.equal(result.status, 'candidate-failure');
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0]!.path, 'facts.json');
  assert.equal(result.strictSuccess, false);
});
test('saved output regrades offline, preserves semantic coverage and detects tampered trace evidence', async () => {
  const { requests, saveDirectory } = await run('direct');
  const graded = await regradeSaved(saveDirectory, { mode: 'offline-control' });
  assert.equal(requests, 2);
  assert.equal(graded.result.criteria.find((item) => item.id === 'C4')!.verdict, 'pass');
  assert.equal(graded.result.criteria.find((item) => item.id === 'S1')!.verdict, 'ungraded');
  assert.equal(graded.result.strictSuccess, false);
  await assert.rejects(regradeSaved(saveDirectory), /VERIFIER_REVIEW_PENDING/);
  await writeFile(path.join(saveDirectory, 'trace.jsonl'), '');
  await assert.rejects(
    regradeSaved(saveDirectory, { mode: 'offline-control' }),
    /EXECUTION_EVIDENCE_CHANGED/,
  );
});

test('saved candidate evidence retains unresolved semantic scopes and replays judge receipts without candidate or judge requests', async () => {
  const { requests, saveDirectory } = await run('direct');
  const profile = JudgeProfileSchema.parse(
    await readJson('profiles/judges/single-exploratory.json'),
  );
  const mock: typeof fetch = async () =>
    assert.fail('Unresolved draft evidence must not reach a judge');
  const judged = await regradeSaved(saveDirectory, {
    mode: 'offline-control',
    semantic: { profile, mode: 'offline-control', fetch: mock },
  });
  assert.equal(requests, 2);
  assert.equal(judged.result.criteria.find((item) => item.id === 'S1')!.verdict, 'error');
  assert.equal(judged.result.strictSuccess, false);
  assert.ok(judged.semanticReceiptFile);
  const receiptBytes = await readFile(path.join(saveDirectory, judged.semanticReceiptFile));
  const replay = await regradeSaved(saveDirectory, {
    mode: 'offline-control',
    replayReceipt: judged.semanticReceiptFile,
  });
  assert.deepEqual(replay.result, judged.result);
  assert.equal(requests, 2);
  assert.deepEqual(
    await readFile(path.join(saveDirectory, judged.semanticReceiptFile)),
    receiptBytes,
  );
  const original = JSON.parse(await readFile(path.join(saveDirectory, 'result.json'), 'utf8'));
  assert.equal(original.gradingStatus, 'ungraded');
});
