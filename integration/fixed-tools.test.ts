import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DisposableDatabase } from '#src/environments/guri/database';
import { GuriBridge } from '#src/environments/guri/bridge';
import { Session } from '#src/environments/session';
import { FixedToolsEnvironment, FIXED_TOOL_SCHEMAS } from '#src/environments/fixed-tools';
import { DocumentWorkspace } from '#src/environments/documents';
import { ScriptedOperator, InteractionScriptSchema } from '#src/harness/operator';
import { discover } from '#tasks/discover';
import { directAdapter } from '#src/harness/adapters/direct';
import { runCandidate } from '#src/harness/loop';
import { TraceEventSchema } from '#contracts/trace';
import { verifyTrace } from '#src/grading/trace';
import { RecordingPorts } from '#src/environments/guri/ports';
import { saveIndependentEvidence } from '#src/environments/guri/evidence';
import { readJson } from '#src/io';
import { GURI_TOOL_VERSIONS, type GuriTool } from '#src/environments/guri/tools';
test.each(['approved', 'cancelled'] as const)(
  'SDK loop records focused clarification and %s canonical write outcome',
  async (decision) => {
    const root = process.cwd();
    await mkdir('tmp', { recursive: true });
    const directory = await mkdtemp(path.resolve('tmp/fixed-control-'));
    const database = await DisposableDatabase.create(
      'postgresql://royal_lab:royal-lab-disposable-only@127.0.0.1:55432/royal_lab_control',
      await readFile('.cache/guri/schema.sql', 'utf8'),
    );
    try {
      await database.seed();
      const before = await database.snapshot();
      const task = structuredClone(
        (await discover(root)).find((item) => item.task.definitionId === 'D01')!.task,
      );
      task.profiles = ['fixed-tools'];
      task.tools = ['find_leads', 'ask_operator', 'create_lead_task', 'write'].map((name) => ({
        name,
        version: GURI_TOOL_VERSIONS[name as GuriTool] ?? '1.0.0',
      }));
      task.limits.maxTurns = 8;
      const workspace = await DocumentWorkspace.create(root, task, path.join(directory, 'outputs'));
      const session = new Session('fixed-control-session', 'builder-owner');
      const script = InteractionScriptSchema.parse(
        await readJson('fixtures/interactions/lead-follow-up.json'),
      );
      script.branches.find((branch) => branch.type === 'approval')!.decision = decision;
      const bridge = new GuriBridge(
        path.join(root, '.guri'),
        path.join(root, '.cache/guri'),
        database.url,
        task.clock.instant,
      );
      const environment = new FixedToolsEnvironment(
        workspace,
        bridge,
        session,
        new ScriptedOperator(script, 'offline-control'),
      );
      let requests = 0;
      const calls = [
        [{ name: 'find_leads', args: { query: 'Amelia' } }],
        [{ name: 'ask_operator', args: { question: 'Which Amelia should I follow up?' } }],
        [
          {
            name: 'create_lead_task',
            args: {
              leadId: 101,
              type: 'CALL',
              dueDate: '2026-10-05',
              dueTime: '10:00',
              notes: 'Confirm duplex scope.',
            },
          },
        ],
        [
          {
            name: 'write',
            args: {
              path: 'facts.json',
              content: JSON.stringify({ created: decision === 'approved' }),
            },
          },
          {
            name: 'write',
            args: {
              path: 'review.md',
              content:
                decision === 'approved'
                  ? 'Created the approved task for lead 101.'
                  : 'Owner cancelled. No task was created.',
            },
          },
        ],
      ];
      const adapter = await directAdapter({
        offlineControl: true,
        model: 'offline-fixed-control',
        apiKey: 'offline-test-key',
        fetch: async () => {
          const step = calls[requests++];
          return new Response(
            JSON.stringify({
              id: `control-${requests}`,
              object: 'chat.completion',
              created: 1,
              model: 'offline-fixed-control',
              choices: [
                {
                  index: 0,
                  finish_reason: step ? 'tool_calls' : 'stop',
                  message: {
                    role: 'assistant',
                    content: step ? null : 'Saved artifacts.',
                    ...(step
                      ? {
                          tool_calls: step.map((call, index) => ({
                            id: `step-${requests}-${index}`,
                            type: 'function',
                            function: { name: call.name, arguments: JSON.stringify(call.args) },
                          })),
                        }
                      : {}),
                  },
                },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        },
      });
      const result = await runCandidate({
        runId: 'offline-fixed-control',
        task,
        workspace,
        adapter,
        saveDirectory: directory,
        executionProfile: 'fixed-tools',
        systemPrompt: await readFile('src/harness/prompts/fixed-tools.txt', 'utf8'),
        pricing: {
          version: '1.0.0',
          asOf: '2026-10-01T00:00:00Z',
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
        },
        schemas: FIXED_TOOL_SCHEMAS,
        execute: environment.execute,
        attachTrace: environment.attachTrace,
        afterExecution: environment.afterExecution,
        committedEffects: environment.committedEffects,
      });
      assert.equal(result.status, 'completed', result.reason ?? '');
      assert.equal(result.strictSuccess, false);
      const state = await saveIndependentEvidence(
        directory,
        database,
        before,
        new RecordingPorts(),
      );
      assert.equal(state.after.tasks.length, decision === 'approved' ? 1 : 0);
      assert.equal(state.after.operations.length, decision === 'approved' ? 1 : 0);
      const trace = (await readFile(path.join(directory, 'trace.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => TraceEventSchema.parse(JSON.parse(line)));
      assert.equal(
        verifyTrace(trace, {
          mutationTools: ['create_lead_task'],
          requiredQuestion: true,
          ownerId: session.ownerId,
          sessionId: session.id,
        }).verdict,
        'pass',
      );
      assert.ok(
        trace.some(
          (event) => event.type === 'operator-input' && event.responderId === 'builder-owner',
        ),
      );
      assert.ok(trace.some((event) => event.type === 'approval' && event.decision === decision));
      assert.equal(result.usage.committedEffects, decision === 'approved' ? 1 : 0);
      assert.ok(
        trace.some((event) => event.type === 'effect-committed') === (decision === 'approved'),
      );
    } finally {
      await database.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
