import { describe, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ExperimentSpecSchema } from '#contracts/experiment';
import {
  CASE,
  ROOT,
  bodies,
  mockFactory,
  runtime,
  spec,
  workspace,
} from './helpers/experiments.js';
import { describePlan, planExperiment } from '#runs/manifest';
import { ExperimentLedger, experimentDirectory, verifyBundle } from '#runs/artifacts';
import { classifyTermination, SpendLedger, estimateSpend } from '#runs/budget';
import { planRerun, trialStates } from '#runs/resume';
import { documentTrialExecutor, regradeExperiment, runExperiment } from '#runs/sweep';
import { planTrials, seededPermutation, ResourceLocks, externalLock } from '#runs/scheduler';
import { readJson } from '#src/io';
import { main } from '#src/cli';
// Recorded reviews approve the committed packs; these gate tests generate an
// all-draft copy so the review gate itself stays exercised.
vi.mock('#fixtures/reviews', async (original) => ({
  ...(await original<typeof import('#fixtures/reviews')>()),
  caseReview: (_id: string, draft: unknown) => draft,
  fixtureReview: (_id: string, draft: unknown) => draft,
}));

describe('repeat-run orchestration (#16)', () => {
  test('seeded paired order is reproducible and every block holds every configuration', () => {
    const configs = ['a', 'b', 'c'];
    assert.deepEqual(seededPermutation(configs, 's'), seededPermutation(configs, 's'));
    const trials = planTrials(['x', 'y'], configs, 3, 'seed', 'documents');
    assert.equal(trials.length, 18);
    assert.equal(new Set(trials.map((t) => t.trialId)).size, 18);
    for (let block = 0; block < 6; block++)
      assert.deepEqual(
        trials
          .filter((t) => t.block === block)
          .map((t) => t.configurationId)
          .sort(),
        configs,
      );
    // Orders differ across blocks for some seed, so the order is genuinely randomized.
    const orders = new Set(
      [...Array(6).keys()].map((block) =>
        trials
          .filter((t) => t.block === block)
          .map((t) => t.configurationId)
          .join(),
      ),
    );
    assert.ok(orders.size > 1);
    assert.deepEqual(planTrials(['x'], configs, 1, 'seed', 'royal-eve')[0]!.resources, [
      'royal-eve-staging',
    ]);
  });

  test('dry run freezes the full matrix, exclusions and bounded spend; drafts stay blocked', async () => {
    const root = await workspace();
    const plan = await planExperiment(root, spec(), { runtime });
    assert.equal(plan.trials.length, 6);
    assert.equal(plan.preflight.mode, 'execution-readiness');
    assert.equal(plan.preflight.valid, false, 'draft packs cannot pass run preflight');
    const suite = (await readJson(path.join(root, 'suites/held-out.json'))) as { cases: string[] };
    assert.equal(plan.cases.length, suite.cases.length, 'every suite case is preserved');
    assert.equal(plan.cases.filter((item) => item.status === 'excluded').length, 7);
    assert.match(plan.cases.find((item) => item.taskId === CASE)!.reason!, /review is pending/);
    // Bounded: 2 x 3 trials at the token ceiling (200k in at $1/M + 12k out at $2/M),
    // which is below the $1 per-trial ceiling.
    assert.equal(plan.estimate.boundedCandidateUsd, 6 * 0.224);
    assert.equal(plan.estimate.candidateTrials, 6);
    const text = describePlan(plan);
    assert.match(text, /Planned candidate trials: 6/);
    assert.match(text, /EXECUTION BLOCKED/);
    const ledger = await ExperimentLedger.create(
      experimentDirectory(root, plan.experimentId),
      plan,
    );
    await assert.rejects(
      runExperiment(root, ledger, { allowPaid: false, executor: async () => assert.fail() }),
      /PAID_EXECUTION_DISABLED/,
    );
    await assert.rejects(
      runExperiment(root, ledger, { allowPaid: true, executor: async () => assert.fail() }),
      /EXPERIMENT_PREFLIGHT_FAILED/,
    );
  });

  test('two configurations x three repeats produce six unique sealed, isolated trial bundles', async () => {
    const root = await workspace();
    const plan = await planExperiment(root, spec(), { mode: 'offline-control', runtime });
    const ledger = await ExperimentLedger.create(
      experimentDirectory(root, plan.experimentId),
      plan,
    );
    bodies.length = 0;
    const outcome = await runExperiment(root, ledger, {
      allowPaid: false,
      executor: documentTrialExecutor(mockFactory()),
    });
    assert.equal(outcome.stopped, null);
    assert.deepEqual(outcome.controllerErrors, []);
    const states = trialStates(ledger);
    assert.equal(states.length, 6);
    assert.equal(new Set(states.map((s) => s.trial.trialId)).size, 6);
    assert.ok(states.every((s) => s.status === 'completed' && s.bundleHash));
    assert.ok(states.every((s) => s.grades.length === 1));
    const markersSeen = new Set<string>();
    for (const state of states) {
      const directory = ledger.trialDirectory(state.trial.trialId);
      const receipt = await verifyBundle(directory, state.bundleHash!);
      assert.ok(receipt.files.some((file) => file.path === 'trace.jsonl'));
      const facts = (await readJson(path.join(directory, 'outputs/facts.json'))) as {
        marker: string;
      };
      markersSeen.add(facts.marker);
      assert.equal(
        (await readdir(path.join(directory, 'outputs'))).sort().join(),
        'facts.json,review.md',
      );
    }
    assert.equal(markersSeen.size, 6, 'each trial wrote only its own outputs');
    // A later request never observes another trial's marker: no shared workspace.
    for (const body of bodies) {
      const [own, request] = body.split('|');
      for (const other of markersSeen)
        if (other !== own) assert.ok(!request!.includes(other), 'workspace state leaked');
    }
    // Reopening verifies the plan hash and ledger chain.
    const reopened = await ExperimentLedger.open(ledger.directory);
    assert.equal(reopened.all.length, ledger.all.length);
    // Sealed bundles are immutable: editing a sealed file is detected.
    const first = states[0]!;
    await writeFile(
      path.join(ledger.trialDirectory(first.trial.trialId), 'outputs/review.md'),
      'tampered',
    );
    await assert.rejects(
      verifyBundle(ledger.trialDirectory(first.trial.trialId), first.bundleHash!),
      /TRIAL_BUNDLE_CHANGED/,
    );
  });

  test('interruption, resume and reruns never omit or replace an attempt', async () => {
    const root = await workspace();
    const plan = await planExperiment(root, spec(), { mode: 'offline-control', runtime });
    const ledger = await ExperimentLedger.create(
      experimentDirectory(root, plan.experimentId),
      plan,
    );
    // Simulate a crash: one trial started, never finished; one failed outright.
    const [crashed, failing] = plan.trials;
    await ledger.append({ type: 'trial-started', trialId: crashed!.trialId, attemptOf: null });
    const executor = documentTrialExecutor(mockFactory());
    const outcome = await runExperiment(root, ledger, {
      allowPaid: false,
      executor: async (input) => {
        if (input.trial.trialId === failing!.trialId) throw new Error('PROVIDER_OUTAGE simulated');
        return executor(input);
      },
    });
    assert.deepEqual(outcome.interrupted, [crashed!.trialId]);
    const states = trialStates(ledger);
    assert.equal(states.length, 6);
    assert.equal(states.find((s) => s.trial.trialId === crashed!.trialId)!.status, 'interrupted');
    const failed = states.find((s) => s.trial.trialId === failing!.trialId)!;
    assert.equal(failed.status, 'infrastructure-error');
    assert.match(failed.reason!, /PROVIDER_OUTAGE/);
    assert.equal(states.filter((s) => s.status === 'completed').length, 4);
    // The interrupted and failed trials have unknown cost, charged at their bound.
    assert.equal(failed.usage!.candidateCostUsd, null);
    assert.equal(outcome.spend.unknownCandidateTrials, 2);
    // A second resume has nothing left and changes nothing.
    const again = await runExperiment(root, ledger, { allowPaid: false, executor });
    assert.deepEqual(again.interrupted, []);
    assert.equal(trialStates(ledger).length, 6);
    // A rerun is a new trial that keeps the failed original in the record.
    const rerun = await planRerun(ledger, failing!.trialId, 'Provider outage resolved');
    assert.notEqual(rerun.trialId, failing!.trialId);
    await runExperiment(root, ledger, { allowPaid: false, executor });
    const final = trialStates(ledger);
    assert.equal(final.length, 7);
    assert.equal(
      final.find((s) => s.trial.trialId === failing!.trialId)!.status,
      'infrastructure-error',
    );
    assert.equal(final.find((s) => s.trial.trialId === rerun.trialId)!.rerunOf, failing!.trialId);
    await assert.rejects(planRerun(ledger, 'trial-unknown', 'x'), /UNKNOWN_TRIAL/);
    // Ledger tampering is detected on reopen.
    await appendFile(path.join(ledger.directory, 'ledger.jsonl'), '{"bad":true}\n');
    await assert.rejects(ExperimentLedger.open(ledger.directory));
    // Regrading appends new grade records and never rewrites earlier ones.
    const before = ledger.all.filter((e) => e.type === 'trial-graded').length;
    const graded = await regradeExperiment(ledger);
    assert.ok(graded.length >= 5);
    assert.equal(
      ledger.all.filter((e) => e.type === 'trial-graded').length,
      before + graded.length,
    );
  });

  test('resource ceilings stop before the next trial and classify every unstarted trial', async () => {
    const root = await workspace();
    // Each trial reserves its $0.224 worst case. With two trials admitted at once,
    // the second reservation would exceed $0.30, so the sweep stops before it.
    const plan = await planExperiment(
      root,
      spec({
        concurrency: 2,
        budget: {
          perTrialCandidateUsd: 0.3,
          perTrialJudgeUsd: 0,
          totalCandidateUsd: 0.3,
          totalJudgeUsd: 0,
          maxWallClockMs: 600_000,
        },
      }),
      { mode: 'offline-control', runtime },
    );
    assert.equal(plan.estimate.withinBudget, false);
    const ledger = await ExperimentLedger.create(
      experimentDirectory(root, plan.experimentId),
      plan,
    );
    const outcome = await runExperiment(root, ledger, {
      allowPaid: false,
      executor: documentTrialExecutor(mockFactory()),
    });
    assert.equal(outcome.stopped, 'candidate-budget');
    const states = trialStates(ledger);
    assert.equal(states.length, 6);
    assert.equal(states.filter((s) => s.status === 'completed').length, 1);
    assert.equal(states.filter((s) => s.status === 'budget-stopped').length, 5);
    assert.ok(states.every((s) => s.state === 'finished'));
    assert.equal(classifyTermination('budget-stopped').coverage, 'missing');
    assert.equal(classifyTermination('budget-exhausted').coverage, 'candidate-failure');
    assert.equal(classifyTermination('interrupted').coverage, 'missing');
    assert.equal(classifyTermination('infrastructure-error').coverage, 'invalid');
    assert.ok(ledger.all.some((e) => e.type === 'experiment-stopped'));

    // Unknown usage is charged its worst-case bound, never $0: with $0.50 only two
    // unknown-cost trials fit, although their (unreported) real cost was tiny.
    const unknownRoot = await workspace();
    const unknownSpec = spec({
      concurrency: 1,
      budget: { ...spec().budget, perTrialCandidateUsd: 0.5, totalCandidateUsd: 0.5 },
    });
    const unknownPlan = await planExperiment(unknownRoot, unknownSpec, {
      mode: 'offline-control',
      runtime,
    });
    const unknownLedger = await ExperimentLedger.create(
      experimentDirectory(unknownRoot, unknownPlan.experimentId),
      unknownPlan,
    );
    const unknown = await runExperiment(unknownRoot, unknownLedger, {
      allowPaid: false,
      executor: documentTrialExecutor(mockFactory({ unknownUsage: true })),
    });
    assert.equal(unknown.stopped, 'candidate-budget');
    assert.deepEqual(unknown.spend, {
      knownCandidateUsd: 0,
      unknownCandidateTrials: 2,
      unknownCandidateBoundUsd: 0.448,
    });
    const unknownStates = trialStates(unknownLedger);
    assert.equal(unknownStates.filter((s) => s.status === 'budget-stopped').length, 4);
    assert.equal(unknownStates[0]!.usage!.candidateCostUsd, null);
    // A trial with unknown cost and no positive bound stops all further admission.
    const unbounded = new SpendLedger(plan.spec.budget);
    unbounded.settle(0, null);
    assert.equal(
      (unbounded.admit(0.01) as { classification: string }).classification,
      'unknown-usage',
    );

    // Wall-clock ceiling is checked before admission.
    let now = 0;
    const clocked = new SpendLedger(plan.spec.budget, () => now);
    assert.deepEqual(clocked.admit(0.1), { ok: true });
    now = 600_000;
    assert.equal((clocked.admit(0) as { classification: string }).classification, 'wall-clock');
  });

  test('CLI dry run prints the frozen matrix without writing results or spending', async () => {
    const root = await workspace();
    await mkdir(path.join(root, 'templates'));
    await writeFile(
      path.join(root, 'templates/experiment.example.json'),
      await readFile(path.join(ROOT, 'templates/experiment.example.json')),
    );
    ExperimentSpecSchema.parse(
      await readJson(path.join(root, 'templates/experiment.example.json')),
    );
    const logs: string[] = [];
    const original = console.log;
    console.log = (value: unknown) => logs.push(String(value));
    try {
      const code = await main([
        'plan',
        '--experiment',
        'templates/experiment.example.json',
        '--root',
        root,
      ]);
      assert.equal(code, 1, 'draft cases block execution readiness');
      await assert.rejects(
        main(['sweep', '--experiment', 'templates/experiment.example.json', '--root', root]),
        /PAID_EXECUTION_DISABLED/,
      );
    } finally {
      console.log = original;
    }
    const text = logs.join(String.fromCharCode(10));
    assert.match(text, /DRY RUN, no candidate or judge request/);
    assert.match(text, /Planned candidate trials: 6/);
    assert.match(text, /zero pricing/);
    await assert.rejects(readdir(path.join(root, 'results')));
  });

  test('estimates keep unknown judge pricing explicit and locks serialize shared resources', async () => {
    const estimate = estimateSpend({
      trials: [
        {
          configurationId: 'config-a',
          limits: {
            maxTurns: 1,
            maxToolCalls: 1,
            maxInputTokens: 1_000_000,
            maxOutputTokens: 1_000_000,
            maxDurationMs: 1,
            maxCostUsd: 2,
          },
          semanticCriteria: 2,
        },
      ],
      configurations: [spec().configurations[0]!],
      budget: spec().budget,
      assumptions: spec().usageAssumptions,
      judges: { count: 2, pricing: [null, null] },
    });
    assert.equal(estimate.judgeCalls, 4);
    assert.equal(estimate.expectedJudgeUsd, null);
    assert.ok(estimate.assumptions.some((line) => /unknown, not zero/.test(line)));
    assert.equal(estimate.boundedCandidateUsd, 1, 'per-trial ceiling caps token bound');

    const locks = new ResourceLocks();
    const order: string[] = [];
    const first = await locks.acquire(['eve']);
    const second = locks.acquire(['eve']).then((release) => {
      order.push('second');
      release();
    });
    order.push('first');
    first();
    await second;
    assert.deepEqual(order, ['first', 'second']);
    const root = await workspace();
    const lockFile = path.join(root, 'eve.lock');
    const release = await externalLock(lockFile, 'run-1');
    await assert.rejects(externalLock(lockFile, 'run-2'), /EXTERNAL_LOCK_HELD/);
    await release();
    await (
      await externalLock(lockFile, 'run-3')
    )();
  });
});
