import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Task } from '#contracts/task';
import type { CaseControl } from '#contracts/authoring';
import { TraceEventSchema } from '#contracts/trace';
import { DisposableDatabase } from '#src/environments/guri/database';
import { GuriBridge } from '#src/environments/guri/bridge';
import { RecordingPorts } from '#src/environments/guri/ports';
import { saveIndependentEvidence } from '#src/environments/guri/evidence';
import { DocumentWorkspace } from '#src/environments/documents';
import { FixedToolsEnvironment, FIXED_TOOL_SCHEMAS } from '#src/environments/fixed-tools';
import { Session } from '#src/environments/session';
import { ScriptedOperator } from '#src/harness/operator';
import { directAdapter } from '#src/harness/adapters/direct';
import { runCandidate } from '#src/harness/loop';
import { gradeDeterministic } from '#src/grading/deterministic';
import { compareControl, type ControlOutcome } from '#src/grading/controls';
import { jsonText } from '#src/io';
import { validateTask } from '#tasks/validate';

type Trajectory = Extract<CaseControl, { mode: 'trajectory' }>;
// Offline transport replaying a control's scripted turns. It never reaches a
// provider; it exists to exercise the real loop, environment and graders.
export async function scriptedAdapter(steps: Trajectory['steps'], model = 'offline-case-control') {
  let requests = 0;
  return directAdapter({
    offlineControl: true,
    model,
    apiKey: 'offline-control-key',
    fetch: async () => {
      const step = steps[requests++];
      return new Response(
        JSON.stringify({
          id: `control-${requests}`,
          object: 'chat.completion',
          created: 1,
          model,
          choices: [
            {
              index: 0,
              finish_reason: step ? 'tool_calls' : 'stop',
              message: {
                role: 'assistant',
                content: step ? null : 'Deliverables written.',
                ...(step
                  ? {
                      tool_calls: step.map((call, index) => ({
                        id: `step-${requests}-${index}`,
                        type: 'function',
                        function: { name: call.tool, arguments: JSON.stringify(call.arguments) },
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
}
export interface TrajectoryOutcome extends ControlOutcome {
  status: string;
  expectedStatus: string;
  directory: string;
}
// Executes one hidden trajectory control on a freshly seeded disposable database
// through the canonical bridge, then grades saved artifacts, independent state and
// trace offline. Offline measurement evidence only: not a model run or score.
export async function runTrajectoryControl(options: {
  root: string;
  task: Task;
  controlId: string;
  controlUrl: string;
  directory: string;
}): Promise<TrajectoryOutcome> {
  const { root, task, directory } = options;
  const validated = await validateTask(root, task);
  const control = validated.controls?.controls.find((item) => item.id === options.controlId);
  if (
    !control ||
    control.mode !== 'trajectory' ||
    !validated.environment ||
    !validated.verification
  )
    throw new Error('CONTROL_UNAVAILABLE: authored fixed-tools trajectory control required');
  const environmentSpec = validated.environment;
  await mkdir(directory, { recursive: true });
  const database = await DisposableDatabase.create(
    options.controlUrl,
    await readFile(path.join(root, '.cache/guri/schema.sql'), 'utf8'),
  );
  try {
    await database.seedCase(environmentSpec.seed, task.id);
    const before = await database.snapshot();
    const workspace = await DocumentWorkspace.create(root, task, path.join(directory, 'outputs'));
    const session = new Session(environmentSpec.session.sessionId, environmentSpec.session.ownerId);
    const bridge = new GuriBridge(
      path.join(root, '.guri'),
      path.join(root, '.cache/guri'),
      database.url,
      task.clock.instant,
      environmentSpec.bridge,
    );
    const environment = new FixedToolsEnvironment(
      workspace,
      bridge,
      session,
      new ScriptedOperator(environmentSpec.operator, 'offline-control'),
      environmentSpec.controller,
    );
    const result = await runCandidate({
      runId: `control-${control.id}`,
      task,
      workspace,
      adapter: await scriptedAdapter(control.steps),
      saveDirectory: directory,
      executionProfile: 'fixed-tools',
      systemPrompt: await readFile(path.join(root, 'src/harness/prompts/fixed-tools.txt'), 'utf8'),
      pricing: {
        version: '1.0.0',
        asOf: '2026-10-01T00:00:00Z',
        inputUsdPerMillion: 0,
        outputUsdPerMillion: 0,
      },
      schemas: FIXED_TOOL_SCHEMAS,
      execute: environment.execute,
      attachTrace: environment.attachTrace,
      afterExecution: environment.afterExecution,
      committedEffects: environment.committedEffects,
    });
    const state = await saveIndependentEvidence(directory, database, before, new RecordingPorts());
    await writeFile(
      path.join(directory, 'controller-events.json'),
      jsonText(environment.controllerEvents),
      { flag: 'wx' },
    );
    const trace = (await readFile(path.join(directory, 'trace.jsonl'), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => TraceEventSchema.parse(JSON.parse(line)));
    const graded = await gradeDeterministic(
      validated.rubric,
      path.join(directory, 'outputs'),
      result,
      {
        plan: validated.verification,
        state: { source: state.source, before: state.before, after: state.after },
        trace,
        sources: workspace.snapshot().map((document) => ({
          id: document.id,
          locators: document.units.map((unit) => unit.locator),
        })),
        mode: 'offline-control',
      },
    );
    await writeFile(path.join(directory, 'control-grade.json'), jsonText(graded), { flag: 'wx' });
    const outcome = compareControl(control, graded);
    return {
      ...outcome,
      matches: outcome.matches && result.status === control.expectedStatus,
      status: result.status,
      expectedStatus: control.expectedStatus,
      directory,
    };
  } finally {
    await database.dispose();
  }
}
