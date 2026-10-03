import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  ExperimentPlanSchema,
  ExperimentSpecSchema,
  type ExperimentPlan,
  type ExperimentSpec,
  type PlannedCase,
} from '#contracts/experiment';
import { JudgeProfileSchema } from '#contracts/judge';
import { discover } from '#tasks/discover';
import { preflight, validateTask } from '#tasks/validate';
import { DOCUMENT_TOOL_SCHEMAS } from '#src/environments/documents';
import { readJson, readScoped, securePath, sha256 } from '#src/io';
import { stableJson } from '#src/environments/session';
import { estimateSpend } from '#runs/budget';
import { planTrials } from '#runs/scheduler';

const exec = promisify(execFile);
export interface PlanOptions {
  mode?: 'benchmark' | 'offline-control';
  now?: () => string;
  newTrialId?: () => string;
  experimentId?: string;
  // Tests may supply the runner identity instead of reading Git.
  runtime?: { runnerRevision: string | null; runnerDirty: boolean };
}
async function gitIdentity(root: string) {
  try {
    const git = async (...args: string[]) =>
      (await exec('git', ['-C', root, ...args], { windowsHide: true })).stdout.trim();
    return {
      runnerRevision: (await git('rev-parse', 'HEAD')) || null,
      runnerDirty: (await git('status', '--porcelain', '--untracked-files=all')).length > 0,
    };
  } catch {
    return { runnerRevision: null, runnerDirty: true };
  }
}
export function experimentIdFor(spec: ExperimentSpec, at: string) {
  return `${spec.id}-${at.replace(/[^0-9]/g, '').slice(0, 14)}-${sha256(`${spec.id}:${at}:${spec.seed}`).slice(0, 8)}`;
}

// Freeze the full selected suite x configuration x repeat matrix before any spend.
// Planning is offline: it never resolves a credential or contacts a provider.
export async function planExperiment(
  root: string,
  specInput: unknown,
  options: PlanOptions = {},
): Promise<ExperimentPlan> {
  const spec = ExperimentSpecSchema.parse(specInput);
  const mode = options.mode ?? 'benchmark';
  const createdAt = (options.now ?? (() => new Date().toISOString()))();
  const integrity = await preflight(root, spec.suite, false);
  const readiness = mode === 'benchmark' ? await preflight(root, spec.suite, true) : integrity;
  const suiteBytes = await readScoped(root, spec.suite);
  const profileFile = `profiles/${readiness.suite.profile}.json`;
  const profileBytes = await readScoped(root, profileFile);
  const discovered = await discover(root);
  for (const id of spec.cases ?? [])
    if (!readiness.suite.cases.includes(id)) throw new Error(`EXPERIMENT_CASE_NOT_IN_SUITE: ${id}`);
  const cases: PlannedCase[] = [];
  for (const selection of readiness.cases) {
    const entry = discovered.find((item) => item.task.id === selection.taskId);
    const explicitlySelected = !spec.cases || spec.cases.includes(selection.taskId);
    const base = {
      taskId: selection.taskId,
      role: (entry?.task.role ?? 'specimen') as PlannedCase['role'],
      definitionId: entry?.task.definitionId ?? 'D00',
    };
    const integrityStatus = integrity.cases.find((item) => item.taskId === selection.taskId);
    const intact = integrityStatus?.status === 'ready';
    if (!entry) {
      cases.push({
        ...base,
        selected: false,
        integrity: 'invalid',
        status: 'invalid',
        reason: selection.reason ?? 'Selected task is missing',
        hashes: null,
        semanticCriteria: 0,
        limits: null,
      });
      continue;
    }
    const { task } = entry;
    let semanticCriteria = 0;
    try {
      semanticCriteria = (await validateTask(root, task)).rubric.criteria.filter(
        (criterion) => criterion.method === 'semantic',
      ).length;
    } catch {}
    const status = !explicitlySelected ? 'excluded' : selection.status;
    cases.push({
      ...base,
      selected: explicitlySelected && intact,
      integrity: intact ? 'valid' : 'invalid',
      status,
      reason: !explicitlySelected
        ? 'Not in the explicit experiment case selection'
        : (selection.reason ?? (intact ? null : (integrityStatus?.reason ?? null))),
      hashes: {
        task: sha256(stableJson(task)),
        fixture: task.fixtureHash,
        rubric: task.rubricHash,
        provenance: task.provenanceHash,
        verification: task.verificationHash ?? null,
        policy: sha256(
          stableJson(task.inputs.filter((i) => i.kind === 'policy').map((i) => i.sha256)),
        ),
        sources: sha256(
          stableJson(task.inputs.filter((i) => i.kind === 'document').map((i) => i.sha256)),
        ),
        controls: task.controlsHash ?? null,
        environment: task.environmentHash ?? null,
      },
      semanticCriteria,
      limits: task.limits,
    });
  }
  const runnable = cases.filter((item) => item.selected);
  const trials = planTrials(
    runnable.map((item) => item.taskId),
    spec.configurations.map((item) => item.id),
    spec.repeats,
    spec.seed,
    readiness.suite.profile,
    options.newTrialId,
  );
  let judge: ExperimentPlan['judge'] = null;
  let judgeEstimate: Parameters<typeof estimateSpend>[0]['judges'] = null;
  if (spec.judgeProfile) {
    const bytes = await readScoped(root, spec.judgeProfile);
    const profile = JudgeProfileSchema.parse(JSON.parse(bytes.toString('utf8')));
    judge = {
      profileId: profile.id,
      profileVersion: profile.version,
      profileHash: sha256(bytes),
      judges: profile.judges.length,
    };
    judgeEstimate = {
      count: profile.judges.length,
      pricing: profile.judges.map((item) => item.pricing),
    };
  }
  const limitsFor = (taskId: string) => runnable.find((item) => item.taskId === taskId)!;
  const estimate = estimateSpend({
    trials: trials.map((trial) => ({
      configurationId: trial.configurationId,
      limits: limitsFor(trial.taskId).limits!,
      semanticCriteria: limitsFor(trial.taskId).semanticCriteria,
    })),
    configurations: spec.configurations,
    budget: spec.budget,
    assumptions: spec.usageAssumptions,
    judges: judgeEstimate,
  });
  const profile = readiness.profile;
  const toolSchemas =
    profile.id === 'documents'
      ? Object.fromEntries(
          Object.entries(DOCUMENT_TOOL_SCHEMAS).map(([name, schema]) => [
            name,
            z.toJSONSchema(schema),
          ]),
        )
      : profile.tools;
  const identity = options.runtime ?? (await gitIdentity(root));
  const unsigned = {
    schemaVersion: '1.0.0' as const,
    experimentId: options.experimentId ?? experimentIdFor(spec, createdAt),
    createdAt,
    mode,
    spec,
    specHash: sha256(stableJson(spec)),
    suite: {
      id: readiness.suite.id,
      version: readiness.suite.version,
      split: readiness.suite.split,
      profile: readiness.suite.profile,
      hash: sha256(suiteBytes),
    },
    profile: {
      id: profile.id,
      version: profile.version,
      hash: sha256(profileBytes),
      systemPromptHash: profile.systemPromptHash,
      toolSchemaHash: sha256(stableJson(toolSchemas)),
      parserProfile: profile.parserProfile,
    },
    runtime: {
      ...identity,
      lockfileHash: sha256(await readScoped(root, 'pnpm-lock.yaml').catch(() => Buffer.from(''))),
      nodeVersion: process.version,
      guriRevision: profile.guriRevision,
    },
    configurations: spec.configurations.map((configuration) => ({
      ...configuration,
      pricingHash: sha256(stableJson(configuration.pricing)),
      configurationHash: sha256(
        stableJson({
          provider: configuration.provider,
          model: configuration.model,
          parameters: configuration.parameters,
          pricing: configuration.pricing,
        }),
      ),
    })),
    judge,
    preflight: {
      mode:
        mode === 'benchmark' ? ('execution-readiness' as const) : ('offline-integrity' as const),
      valid: readiness.valid,
      errors: readiness.errors,
    },
    cases,
    trials,
    estimate,
  };
  return ExperimentPlanSchema.parse({ ...unsigned, planHash: sha256(stableJson(unsigned)) });
}
export async function loadExperimentSpec(root: string, file: string) {
  return ExperimentSpecSchema.parse(await readJson(await securePath(root, file)));
}

// Human-readable dry-run: the full matrix, counts and bounded spend. No request.
export function describePlan(plan: ExperimentPlan) {
  const count = (status: string) => plan.cases.filter((item) => item.status === status).length;
  const lines = [
    `Experiment ${plan.experimentId} (${plan.mode}) — DRY RUN, no candidate or judge request`,
    `Suite ${plan.suite.id}@${plan.suite.version} [${plan.suite.split}, ${plan.suite.profile}] ${plan.preflight.mode}: ${plan.preflight.valid ? 'valid' : 'NOT VALID'}`,
    `Cases: ${plan.cases.length} in suite, ${plan.cases.filter((c) => c.selected).length} planned, ${count('ready')} execution-ready, ${count('excluded')} excluded, ${count('invalid')} not ready`,
    ...(plan.preflight.valid
      ? []
      : [
          'EXECUTION BLOCKED: the frozen plan can be inspected but a sweep refuses to start until every selected case passes preflight.',
        ]),
    `Configurations: ${plan.configurations.map((c) => `${c.id}=${c.provider}:${c.model}`).join(', ')}`,
    `Repeats: ${plan.spec.repeats}; seed ${JSON.stringify(plan.spec.seed)}; concurrency ${plan.spec.concurrency}`,
    `Planned candidate trials: ${plan.trials.length}; estimated judge calls: ${plan.estimate.judgeCalls}`,
    `Expected candidate spend: $${plan.estimate.expectedCandidateUsd.toFixed(4)}; bounded: $${plan.estimate.boundedCandidateUsd.toFixed(4)} of $${plan.spec.budget.totalCandidateUsd.toFixed(2)}`,
    `Expected judge spend: ${plan.estimate.expectedJudgeUsd === null ? 'UNKNOWN (pricing not pinned)' : `$${plan.estimate.expectedJudgeUsd.toFixed(4)}`}; bounded: $${plan.estimate.boundedJudgeUsd.toFixed(4)} of $${plan.spec.budget.totalJudgeUsd.toFixed(2)}`,
    `Within budget: ${plan.estimate.withinBudget ? 'yes' : 'NO — the run would stop at the ceiling with missing coverage'}`,
    ...plan.estimate.assumptions.map((item) => `  assumption: ${item}`),
    '',
    'Cases:',
    ...plan.cases.map(
      (item) =>
        `  ${item.status.padEnd(8)} ${item.definitionId} ${item.role.padEnd(10)} ${item.taskId}${item.reason ? ` — ${item.reason}` : ''}`,
    ),
    '',
    'Trials (sequence repeat block/order configuration case):',
    ...plan.trials.map(
      (trial) =>
        `  ${String(trial.sequence).padStart(4)} r${trial.repeat} b${trial.block}/${trial.orderInBlock} ${trial.configurationId} ${trial.taskId}${trial.resources.length ? ` [serial: ${trial.resources.join(',')}]` : ''}`,
    ),
  ];
  return lines.join('\n');
}
