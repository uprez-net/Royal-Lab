import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Task } from '#contracts/task';
import type { CaseResult } from '#contracts/result';
import type { ExperimentConfiguration, LedgerEvent, PlannedTrial } from '#contracts/experiment';
import type { CandidateAdapter } from '#src/harness/adapters/base';
import type { Config } from '#src/config';
import { redact } from '#src/config';
import { discover } from '#tasks/discover';
import { validateTask } from '#tasks/validate';
import { DocumentWorkspace } from '#src/environments/documents';
import { VerificationPlanSchema } from '#src/grading/verification';
import { runCandidate } from '#src/harness/loop';
import { jsonText, readScoped, sha256 } from '#src/io';
import { stableJson } from '#src/environments/session';
import { regradeSaved } from '#runs/regrade';
import { DETERMINISTIC_GRADER_VERSION } from '#src/grading/deterministic';
import { ExperimentLedger, sealBundle, verifyBundle } from '#runs/artifacts';
import { SpendLedger, trialCandidateCeiling } from '#runs/budget';
import { prepareResume, trialStates } from '#runs/resume';
import { externalLock, schedule } from '#runs/scheduler';

export interface TrialInput {
  root: string;
  trial: PlannedTrial;
  task: Task;
  configuration: ExperimentConfiguration;
  directory: string;
  mode: 'benchmark' | 'offline-control';
}
export type TrialExecutor = (input: TrialInput) => Promise<CaseResult>;
export type AdapterFactory = (configuration: ExperimentConfiguration) => Promise<CandidateAdapter>;

// Resolve only the explicitly named credential variable, after planning passed.
export const paidAdapterFactory: AdapterFactory = async (configuration) => {
  const apiKey = configuration.apiKeyEnv ? process.env[configuration.apiKeyEnv] : undefined;
  if (!apiKey)
    throw new Error('CANDIDATE_CREDENTIAL_MISSING: configure locally; never paste keys in chat');
  const options = { model: configuration.model, parameters: configuration.parameters, apiKey };
  return configuration.provider === 'direct'
    ? (await import('#src/harness/adapters/direct')).directAdapter(options)
    : (await import('#src/harness/adapters/gateway')).gatewayAdapter(options);
};

// Documents trial: a fresh workspace per trial, so repeats never share outputs.
export function documentTrialExecutor(
  adapters: AdapterFactory,
  binaryParser?: Config['binaryParser'],
): TrialExecutor {
  return async ({ root, trial, task: source, configuration, directory, mode }) => {
    const { rubric, directory: taskDirectory } = await validateTask(root, source);
    if (!source.verificationPath || !source.verificationHash)
      throw new Error('VERIFIER_NOT_DECLARED');
    const planBytes = await readScoped(taskDirectory, source.verificationPath);
    if (sha256(planBytes) !== source.verificationHash) throw new Error('VERIFIER_HASH_MISMATCH');
    const verification = VerificationPlanSchema.parse(JSON.parse(planBytes.toString('utf8')));
    if (mode === 'benchmark' && verification.review.status !== 'approved')
      throw new Error('VERIFIER_REVIEW_PENDING');
    const task = structuredClone(source);
    const systemPrompt = await readFile(
      fileURLToPath(new URL('../harness/prompts/documents.txt', import.meta.url)),
      'utf8',
    );
    const snapshot = {
      task: source,
      rubric,
      verification,
      taskHash: sha256(stableJson(source)),
      rubricHash: sha256(jsonText(rubric)),
      sourceRubricHash: source.rubricHash,
      verificationHash: sha256(jsonText(verification)),
      sourceVerificationHash: sha256(planBytes),
      trialId: trial.trialId,
      configurationId: configuration.id,
      repeat: trial.repeat,
      nodeVersion: process.version,
    };
    await writeFile(path.join(directory, 'grading-inputs.json'), jsonText(snapshot), {
      flag: 'wx',
    });
    const workspace = await DocumentWorkspace.create(root, task, path.join(directory, 'outputs'), {
      ...(binaryParser ? { binaryParser } : {}),
      evidenceRoot: directory,
    });
    const adapter = await adapters(configuration);
    if (mode === 'offline-control' && adapter.executionMode !== 'offline-control')
      throw new Error('OFFLINE_CONTROL_REQUIRES_MOCK_TRANSPORT');
    return runCandidate({
      allowPaid: mode === 'benchmark',
      runId: trial.trialId,
      trial: trial.repeat,
      task,
      adapter,
      workspace,
      saveDirectory: directory,
      systemPrompt,
      pricing: configuration.pricing,
      environmentFingerprint: {
        gradingInputsHash: sha256(jsonText(snapshot)),
        experimentTrial: trial.trialId,
        configurationId: configuration.id,
      },
    });
  };
}

export interface SweepOptions {
  allowPaid: boolean;
  executor: TrialExecutor;
  // Required when any trial touches the shared Royal Eve staging deployment.
  externalLockFile?: string;
  clock?: () => number;
}
// Execute (or resume) a frozen plan. Every planned trial ends with a recorded
// terminal state; stopping early records budget-stopped trials explicitly.
export async function runExperiment(root: string, ledger: ExperimentLedger, options: SweepOptions) {
  const plan = ledger.plan;
  if (plan.mode === 'benchmark') {
    if (!options.allowPaid)
      throw new Error('PAID_EXECUTION_DISABLED: --allow-paid is required for a benchmark sweep');
    if (!plan.preflight.valid)
      throw new Error('EXPERIMENT_PREFLIGHT_FAILED: every selected case must pass run preflight');
    if (plan.runtime.runnerDirty || !plan.runtime.runnerRevision)
      throw new Error('RUNNER_DIRTY: checkpoint implementation and datasets before a benchmark');
  }
  const { interrupted, remaining } = await prepareResume(ledger);
  const spend = new SpendLedger(plan.spec.budget, options.clock);
  const tasks = new Map((await discover(root)).map((entry) => [entry.task.id, entry.task]));
  const ceiling = (trial: PlannedTrial) => {
    const task = tasks.get(trial.taskId);
    const configuration = plan.configurations.find((c) => c.id === trial.configurationId)!;
    return task ? trialCandidateCeiling(task.limits, configuration.pricing, plan.spec.budget) : 0;
  };
  // Earlier attempts (including interrupted ones) count against the budget.
  for (const state of trialStates(ledger))
    if (state.state === 'finished' && state.usage && state.status !== 'budget-stopped')
      spend.settle(ceiling(state.trial), state.usage.candidateCostUsd, false);
  const needsLock = remaining.some((trial) => trial.resources.includes('royal-eve-staging'));
  if (needsLock && !options.externalLockFile)
    throw new Error('EXTERNAL_LOCK_REQUIRED: Royal Eve staging runs serially under a shared lock');
  const release = needsLock
    ? await externalLock(options.externalLockFile!, plan.experimentId)
    : async () => {};
  const reservations = new Map<string, number>();
  // Held in an object: assigned inside the admission callback.
  const halt: {
    value: {
      classification: 'candidate-budget' | 'wall-clock' | 'unknown-usage';
      reason: string;
    } | null;
  } = { value: null };
  const started = new Set<string>();
  const gradingErrors: { trialId: string; reason: string }[] = [];
  let scheduled: Awaited<ReturnType<typeof schedule>>;
  try {
    scheduled = await schedule(remaining, {
      concurrency: needsLock ? 1 : plan.spec.concurrency,
      admit: (trial) => {
        const reservation = ceiling(trial);
        const decision = spend.admit(reservation);
        if (!decision.ok) {
          halt.value = decision;
          return false;
        }
        reservations.set(trial.trialId, reservation);
        started.add(trial.trialId);
        return true;
      },
      run: async (trial) => {
        await ledger.append({ type: 'trial-started', trialId: trial.trialId, attemptOf: null });
        const directory = ledger.trialDirectory(trial.trialId);
        await mkdir(directory, { recursive: false });
        let result: CaseResult | null = null;
        let failure: string | null = null;
        try {
          const task = tasks.get(trial.taskId);
          if (!task) throw new Error(`TASK_NOT_FOUND: ${trial.taskId}`);
          if (
            sha256(stableJson(task)) !== plan.cases.find((c) => c.taskId === task.id)?.hashes?.task
          )
            throw new Error('TASK_CHANGED_SINCE_PLAN');
          const configuration = plan.configurations.find((c) => c.id === trial.configurationId)!;
          // Experiment per-trial ceiling narrows the task's own declared ceiling.
          const limited = structuredClone(task);
          limited.limits.maxCostUsd = Math.min(
            limited.limits.maxCostUsd,
            plan.spec.budget.perTrialCandidateUsd,
          );
          result = await options.executor({
            root,
            trial,
            task: limited,
            configuration,
            directory,
            mode: plan.mode,
          });
        } catch (error) {
          failure = String(redact(error instanceof Error ? error.message : error));
          await writeFile(
            path.join(directory, 'trial-error.json'),
            jsonText({ schemaVersion: '1.0.0', trialId: trial.trialId, reason: failure }),
            { flag: 'wx' },
          ).catch(() => {});
        }
        let bundleHash: string | null = null;
        try {
          bundleHash = await sealBundle(directory, plan.experimentId, trial.trialId);
        } catch {}
        const usage = {
          inputTokens: result?.usage.inputTokens ?? null,
          outputTokens: result?.usage.outputTokens ?? null,
          candidateCostUsd: result ? result.usage.candidateCostUsd : null,
          judgeCostUsd: null,
          durationMs: result?.usage.durationMs ?? null,
        };
        // Without a result the spend is unknown (a request may have started): it is
        // charged the trial's worst-case reservation, never reported as $0.
        spend.settle(reservations.get(trial.trialId) ?? 0, usage.candidateCostUsd);
        await ledger.append({
          type: 'trial-finished',
          trialId: trial.trialId,
          status: result?.status ?? 'infrastructure-error',
          reason: result ? result.reason : failure,
          usage,
          bundleHash,
        });
        if (result && bundleHash)
          try {
            await gradeTrial(ledger, trial.trialId, plan.mode);
          } catch (error) {
            gradingErrors.push({
              trialId: trial.trialId,
              reason: String(redact(error instanceof Error ? error.message : error)),
            });
          }
      },
    });
  } finally {
    await release();
  }
  const stopped = halt.value;
  if (stopped) {
    await ledger.append({
      type: 'experiment-stopped',
      reason: stopped.reason,
      classification: stopped.classification,
    });
    for (const trial of remaining.filter((item) => !started.has(item.trialId)))
      await ledger.append({
        type: 'trial-finished',
        trialId: trial.trialId,
        status: 'budget-stopped',
        reason: stopped.reason,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          candidateCostUsd: 0,
          judgeCostUsd: 0,
          durationMs: 0,
        },
        bundleHash: null,
      });
  }
  return {
    experimentId: plan.experimentId,
    interrupted,
    stopped: stopped ? stopped.classification : null,
    spend: {
      knownCandidateUsd: spend.knownCandidateUsd,
      unknownCandidateTrials: spend.unknownCandidateTrials,
      unknownCandidateBoundUsd: spend.unknownCandidateBoundUsd,
    },
    gradingErrors,
    controllerErrors: scheduled.errors.map((error) =>
      String(redact(error instanceof Error ? error.message : error)),
    ),
    states: trialStates(ledger),
  };
}

// Deterministic regrade of a sealed bundle writes a new grade file and a new ledger
// record. Earlier grade files and raw judge receipts are never rewritten.
export async function gradeTrial(
  ledger: ExperimentLedger,
  trialId: string,
  mode: 'benchmark' | 'offline-control',
) {
  const directory = ledger.trialDirectory(trialId);
  const graded = await regradeSaved(directory, mode === 'offline-control' ? { mode } : {});
  return (await ledger.append({
    type: 'trial-graded',
    trialId,
    gradeFile: `trials/${trialId}/${graded.file}`,
    gradeHash: sha256(await readFile(path.join(directory, graded.file))),
    graderVersion: DETERMINISTIC_GRADER_VERSION,
    strictSuccess: graded.result.strictSuccess,
    gradingStatus: graded.result.gradingStatus,
  })) as Extract<LedgerEvent, { type: 'trial-graded' }>;
}
export async function regradeExperiment(ledger: ExperimentLedger) {
  const graded = [];
  for (const state of trialStates(ledger)) {
    if (state.state !== 'finished' || !state.bundleHash) continue;
    // Verify the sealed bundle first; only executed trials have a receipt to grade.
    const receipt = await verifyBundle(
      ledger.trialDirectory(state.trial.trialId),
      state.bundleHash,
    );
    if (receipt.files.some((file) => file.path === 'execution-receipt.json'))
      graded.push(await gradeTrial(ledger, state.trial.trialId, ledger.plan.mode));
  }
  return graded;
}
