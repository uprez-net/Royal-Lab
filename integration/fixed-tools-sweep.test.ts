import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { ExperimentSpecSchema } from '#contracts/experiment';
import { planExperiment } from '#runs/manifest';
import { ExperimentLedger } from '#runs/artifacts';
import { runExperiment } from '#runs/sweep';
import { trialStates } from '#runs/resume';
import { fixedToolsTrialExecutor } from '#runs/fixed-tools-trial';
import { scriptedAdapter } from '#src/grading/tool-controls';
import { discover } from '#tasks/discover';
import { validateTask } from '#tasks/validate';
import { sha256 } from '#src/io';
import { stableJson } from '#src/environments/session';

// Fixed-tools sweep (#21): 2 configurations x 3 repeats of T02 through the real
// loop, pinned canonical bridge and disposable PostgreSQL. The case's reference
// trajectory stands in for the model (offline control: no provider request).
// Every trial must start from identical seeded state on its own database, so a
// write in one repeat can never appear in another.
const root = process.cwd();
const CONTROL =
  'postgresql://royal_lab:royal-lab-disposable-only@127.0.0.1:55432/royal_lab_control';
const CASE = 'leads/create-approved-follow-up/cedar';
const pricing = {
  version: '1.0.0',
  asOf: '2026-10-01T00:00:00Z',
  inputUsdPerMillion: 0,
  outputUsdPerMillion: 0,
};

test('fixed-tools sweep repeats run on isolated databases and grade independent state', async () => {
  const entry = (await discover(root)).find((item) => item.task.id === CASE)!;
  const reference = (await validateTask(root, entry.task)).controls!.controls.find(
    (control) => control.id === 'reference',
  )!;
  assert.equal(reference.mode, 'trajectory');
  const spec = ExperimentSpecSchema.parse({
    schemaVersion: '1.0.0',
    id: 'fixed-tools-isolation',
    version: '1.0.0',
    description: 'Offline-control fixed-tools sweep isolation check',
    suite: 'suites/fixed-tools-development.json',
    cases: [CASE],
    repeats: 3,
    seed: 'fixed-tools-isolation',
    concurrency: 2,
    configurations: [
      { id: 'config-a', provider: 'direct', model: 'scripted-a', pricing },
      { id: 'config-b', provider: 'direct', model: 'scripted-b', pricing },
    ],
    budget: {
      perTrialCandidateUsd: 1,
      perTrialJudgeUsd: 0,
      totalCandidateUsd: 10,
      totalJudgeUsd: 0,
      maxWallClockMs: 1_800_000,
    },
    usageAssumptions: {
      candidateInputTokensPerTrial: 1000,
      candidateCachedInputTokensPerTrial: 0,
      candidateOutputTokensPerTrial: 100,
      judgeInputTokensPerCall: 0,
      judgeOutputTokensPerCall: 0,
    },
  });
  const plan = await planExperiment(root, spec, {
    mode: 'offline-control',
    runtime: { runnerRevision: null, runnerDirty: true },
  });
  assert.ok(plan.trials.every((trial) => trial.resources.includes('guri-bridge-provisioning')));
  await mkdir(path.join(root, 'tmp'), { recursive: true });
  const ledger = await ExperimentLedger.create(
    path.join(await mkdtemp(path.join(root, 'tmp/fixed-tools-sweep-')), plan.experimentId),
    plan,
  );
  const outcome = await runExperiment(root, ledger, {
    allowPaid: false,
    executor: fixedToolsTrialExecutor(
      () => scriptedAdapter((reference as Extract<typeof reference, { mode: 'trajectory' }>).steps),
      { controlUrl: CONTROL },
    ),
  });
  assert.deepEqual(outcome.controllerErrors, []);
  assert.deepEqual(outcome.gradingErrors, []);
  const states = trialStates(ledger);
  assert.equal(states.length, 6);
  const databases = new Set<string>();
  const before = new Set<string>();
  for (const state of states) {
    assert.equal(state.status, 'completed', state.trial.trialId);
    const directory = ledger.trialDirectory(state.trial.trialId);
    const initialization = JSON.parse(
      await readFile(path.join(directory, 'fixture-initialization.json'), 'utf8'),
    ) as { database: string; snapshot: Record<string, unknown> };
    databases.add(initialization.database);
    // The snapshot names its own database; everything else must be identical.
    const { database: _name, ...seeded } = initialization.snapshot;
    before.add(sha256(stableJson(seeded)));
    const grade = JSON.parse(
      await readFile(
        path.join(directory, state.grades.at(-1)!.gradeFile.split('/').at(-1)!),
        'utf8',
      ),
    ) as { criticalGatesPassed: boolean | null; criteria: { id: string; verdict: string }[] };
    // Independent durable-state assertions graded from the saved bundle.
    assert.equal(grade.criticalGatesPassed, true, JSON.stringify(grade.criteria));
  }
  assert.equal(databases.size, 6, 'each trial used its own database');
  assert.equal(before.size, 1, 'every repeat started from the same seeded state');
  // Every per-trial database was dropped after its trial.
  const observer = new Pool({ connectionString: CONTROL, max: 1 });
  try {
    const { rows } = await observer.query<{ datname: string }>(
      'select datname from pg_database where datname = any($1)',
      [[...databases]],
    );
    assert.deepEqual(rows, []);
  } finally {
    await observer.end();
  }
}, 600_000);
