import { afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedFiles } from '#fixtures/generate';
import { directAdapter } from '#src/harness/adapters/direct';
import { ExperimentSpecSchema, type ExperimentConfiguration } from '#contracts/experiment';

// Shared offline experiment fixtures: temporary roots and mock transports only.
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CASE = 'analytics/explain-pipeline-forecast/estuary';
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
export async function workspace() {
  await mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const root = await mkdtemp(path.join(ROOT, 'tmp/experiment-'));
  temporary.push(root);
  for (const [relative, content] of await generatedFiles()) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
  await mkdir(path.join(root, 'profiles'));
  for (const profile of ['documents', 'fixed-tools', 'royal-eve'])
    await writeFile(
      path.join(root, `profiles/${profile}.json`),
      await readFile(path.join(ROOT, `profiles/${profile}.json`)),
    );
  return root;
}
export const pricing = {
  version: '1.0.0',
  asOf: '2026-10-01T00:00:00Z',
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 2,
};
export const spec = (overrides: Record<string, unknown> = {}) =>
  ExperimentSpecSchema.parse({
    schemaVersion: '1.0.0',
    id: 'stability-test',
    version: '1.0.0',
    description: 'Offline-control orchestration test',
    suite: 'suites/held-out.json',
    cases: [CASE],
    repeats: 3,
    seed: 'seed-1',
    concurrency: 2,
    configurations: [
      { id: 'config-a', provider: 'direct', model: 'mock-a', pricing },
      { id: 'config-b', provider: 'direct', model: 'mock-b', pricing },
    ],
    budget: {
      perTrialCandidateUsd: 1,
      perTrialJudgeUsd: 0,
      totalCandidateUsd: 10,
      totalJudgeUsd: 0,
      maxWallClockMs: 600_000,
    },
    usageAssumptions: {
      candidateInputTokensPerTrial: 1000,
      candidateCachedInputTokensPerTrial: 0,
      candidateOutputTokensPerTrial: 100,
      judgeInputTokensPerCall: 0,
      judgeOutputTokensPerCall: 0,
    },
    ...overrides,
  });
// Offline mock transport: turn 1 lists files and writes a trial-unique marker;
// turn 2 stops. Each request body is captured to prove workspace isolation.
let markers = 0;
export const bodies: string[] = [];
export function mockFactory(
  options: {
    unknownUsage?: boolean;
    facts?: (marker: string) => unknown;
    review?: (marker: string) => string;
  } = {},
) {
  return async (configuration: ExperimentConfiguration) => {
    let requests = 0;
    const marker = `${configuration.id}-marker-${markers++}`;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      bodies.push(`${marker}|${String(init?.body)}`);
      const first = requests++ === 0;
      const calls = first
        ? [
            { name: 'list', args: '{}' },
            {
              name: 'write',
              args: JSON.stringify({
                path: 'facts.json',
                content: JSON.stringify(options.facts ? options.facts(marker) : { marker }),
              }),
            },
            {
              name: 'write',
              args: JSON.stringify({
                path: 'review.md',
                content: options.review ? options.review(marker) : `Marker ${marker}.`,
              }),
            },
          ]
        : [];
      return new Response(
        JSON.stringify({
          id: `mock-${requests}`,
          object: 'chat.completion',
          created: 1,
          model: configuration.model,
          choices: [
            {
              index: 0,
              finish_reason: first ? 'tool_calls' : 'stop',
              message: {
                role: 'assistant',
                content: first ? null : 'Saved.',
                ...(first
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
          ...(options.unknownUsage
            ? {}
            : { usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    return directAdapter({
      offlineControl: true,
      model: configuration.model,
      apiKey: 'offline-test-key',
      fetch,
    });
  };
}
export const runtime = { runnerRevision: null, runnerDirty: true };
