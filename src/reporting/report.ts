import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ExperimentPlan } from '#contracts/experiment';
import { ResultSchema, type CaseResult } from '#contracts/result';
import { RubricSchema, type Rubric } from '#contracts/rubric';
import { TraceEventSchema, type TraceEvent } from '#contracts/trace';
import { SemanticReceiptSchema } from '#contracts/judge';
import { readScoped } from '#src/io';
import { jsonPointer } from '#src/grading/facts';
import { ExperimentLedger } from '#runs/artifacts';
import { classifyTermination, type Coverage } from '#runs/budget';
import { trialStates, type TrialState } from '#runs/resume';

// Reports are built only from the frozen plan, the verified ledger and sealed
// bundles. Missing evidence stays missing: it never becomes a pass or a zero.
export const REPORT_SCHEMA_VERSION = '1.0.0';
export const PROFILE_LABELS = {
  documents: 'Documents',
  'fixed-tools': 'Fixed tools',
  'royal-eve': 'Royal Eve (composed product agent)',
} as const;

export interface CriterionRow {
  id: string;
  title: string;
  severity: 'critical' | 'substantive' | 'diagnostic';
  category: string;
  method: 'deterministic' | 'semantic';
  verdict: 'pass' | 'fail' | 'error' | 'ungraded';
  reason: string;
  expected: unknown;
  actual: unknown;
  evidence: { sourceId: string; locator: string; fact: string }[];
}
export interface TrialRow {
  trialId: string;
  rerunOf: string | null;
  taskId: string;
  definitionId: string;
  role: string;
  family: string;
  configurationId: string;
  repeat: number;
  block: number;
  orderInBlock: number;
  status: string;
  classification: string;
  coverage: Coverage | 'not-finished';
  reason: string | null;
  gradingStatus: 'ungraded' | 'graded' | 'judge-error' | 'missing';
  strictSuccess: boolean;
  criticalGatesPassed: boolean | null;
  criteria: CriterionRow[];
  tools: {
    attempted: { callId: string; tool: string }[];
    executed: { callId: string; tool: string; outcome: string }[];
    approvals: { callId: string; decision: string }[];
    effects: { callId: string; effect: string; operationId: string }[];
  };
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    candidateCostUsd: number | null;
    judgeCostUsd: number | null;
    durationMs: number | null;
  };
  judging: { criteria: number; disagreements: number; adjudications: number } | null;
  links: { bundle: string; grade: string | null; trace: string | null; outputs: string[] };
  explanations: string[];
}
export interface Distribution {
  count: number;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  max: number | null;
}
export interface ConfigurationSummary {
  configurationId: string;
  provider: string;
  model: string;
  counts: Record<
    | 'planned'
    | 'finished'
    | 'completed'
    | 'valid'
    | 'failed'
    | 'graded'
    | 'ungraded'
    | 'invalid'
    | 'missing'
    | 'passed',
    number
  >;
  complete: boolean;
  headline: { strictSuccessRate: number | null; denominator: number; reason: string };
  criticalGatePassRate: number | null;
  macroFamilyScore: number | null;
  familyScores: Record<string, number | null>;
  failureCategories: Record<string, number>;
  criterionDiagnostics: {
    taskId: string;
    criterionId: string;
    severity: string;
    pass: number;
    fail: number;
    error: number;
    ungraded: number;
  }[];
  withinCase: {
    taskId: string;
    trials: number;
    successes: number;
    rate: number;
    variance: number;
  }[];
  latencyMs: Distribution;
  tokens: { input: number | null; output: number | null };
  spend: { candidateUsd: number | null; judgeUsd: number | null; unknownCostTrials: number };
}
export interface ExperimentReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  kind: ExperimentPlan['suite']['profile'];
  label: string;
  experimentId: string;
  mode: ExperimentPlan['mode'];
  benchmarkEligible: boolean;
  identity: {
    planHash: string;
    suite: ExperimentPlan['suite'];
    profile: ExperimentPlan['profile'];
    runtime: ExperimentPlan['runtime'];
    judge: ExperimentPlan['judge'];
    seed: string;
    repeats: number;
    cases: { taskId: string; hashes: ExperimentPlan['cases'][number]['hashes'] }[];
    configurations: ExperimentPlan['configurations'];
  };
  caseCounts: {
    selected: number;
    compatible: number;
    excluded: number;
    planned: number;
    notReady: number;
  };
  exclusions: { taskId: string; status: string; reason: string | null }[];
  configurations: ConfigurationSummary[];
  trials: TrialRow[];
  warnings: string[];
}

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};
export function distribution(values: number[]): Distribution {
  return {
    count: values.length,
    mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    max: values.length ? Math.max(...values) : null,
  };
}
const sum = (values: (number | null)[]) =>
  values.some((value) => value === null) ? null : (values as number[]).reduce((a, b) => a + b, 0);
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

async function readJsonFile(directory: string, file: string) {
  return JSON.parse((await readScoped(directory, file)).toString('utf8')) as unknown;
}
async function trialRow(
  ledger: ExperimentLedger,
  plan: ExperimentPlan,
  state: TrialState,
  base: string,
): Promise<TrialRow> {
  const { trial } = state;
  const directory = ledger.trialDirectory(trial.trialId);
  const planned = plan.cases.find((item) => item.taskId === trial.taskId);
  const terminal = state.status ? classifyTermination(state.status) : null;
  const row: TrialRow = {
    trialId: trial.trialId,
    rerunOf: state.rerunOf,
    taskId: trial.taskId,
    definitionId: planned?.definitionId ?? 'unknown',
    role: planned?.role ?? 'unknown',
    family: trial.taskId.split('/')[0]!,
    configurationId: trial.configurationId,
    repeat: trial.repeat,
    block: trial.block,
    orderInBlock: trial.orderInBlock,
    status: state.status ?? (state.state === 'started' ? 'running' : 'unstarted'),
    classification: terminal?.classification ?? 'not-finished',
    coverage: terminal?.coverage ?? 'not-finished',
    reason: state.reason,
    gradingStatus: 'missing',
    strictSuccess: false,
    criticalGatesPassed: null,
    criteria: [],
    tools: { attempted: [], executed: [], approvals: [], effects: [] },
    usage: state.usage ?? {
      inputTokens: null,
      outputTokens: null,
      candidateCostUsd: null,
      judgeCostUsd: null,
      durationMs: null,
    },
    judging: null,
    links: { bundle: `${base}/trials/${trial.trialId}`, grade: null, trace: null, outputs: [] },
    explanations: [],
  };
  if (!state.bundleHash) {
    if (terminal) row.explanations.push(terminal.explanation);
    return row;
  }
  const files = await readdir(directory).catch(() => [] as string[]);
  // Rubric expectations come from the frozen grading snapshot inside the bundle.
  let rubric: Rubric | null = null;
  if (files.includes('grading-inputs.json'))
    rubric = RubricSchema.parse(
      ((await readJsonFile(directory, 'grading-inputs.json')) as { rubric: unknown }).rubric,
    );
  if (files.includes('trace.jsonl')) {
    row.links.trace = `${base}/trials/${trial.trialId}/trace.jsonl`;
    const events: TraceEvent[] = (await readScoped(directory, 'trace.jsonl'))
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => TraceEventSchema.parse(JSON.parse(line)));
    for (const event of events) {
      if (event.type === 'tool-attempt')
        row.tools.attempted.push({ callId: event.callId, tool: event.tool });
      if (event.type === 'tool-executed')
        row.tools.executed.push({ callId: event.callId, tool: event.tool, outcome: event.outcome });
      if (event.type === 'approval')
        row.tools.approvals.push({ callId: event.callId, decision: event.decision });
      if (event.type === 'effect-committed')
        row.tools.effects.push({
          callId: event.callId,
          effect: event.effect,
          operationId: event.operationId,
        });
    }
  }
  const outputs = files.includes('outputs')
    ? (await readdir(path.join(directory, 'outputs'))).sort()
    : [];
  row.links.outputs = outputs.map((file) => `${base}/trials/${trial.trialId}/outputs/${file}`);
  const latest = state.grades.at(-1);
  let graded: CaseResult | null = null;
  if (latest) {
    const file = path.basename(latest.gradeFile);
    graded = ResultSchema.parse(await readJsonFile(directory, file));
    row.links.grade = `${base}/trials/${trial.trialId}/${file}`;
  }
  // Semantic receipts and human adjudications are separate records; both are counted.
  const receipts = files.filter((file) => /^judge-[\w-]+\.json$/.test(file));
  if (receipts.length) {
    const receipt = SemanticReceiptSchema.parse(
      await readJsonFile(directory, receipts.sort().at(-1)!),
    );
    row.judging = {
      criteria: receipt.criteria.length,
      disagreements: receipt.criteria.filter((item) => item.disagreement).length,
      adjudications: files.filter((file) => /^adjudication-[\w-]+\.json$/.test(file)).length,
    };
  }
  if (graded) {
    row.gradingStatus = graded.gradingStatus;
    row.strictSuccess = graded.strictSuccess;
    row.criticalGatesPassed = graded.criticalGatesPassed;
    row.usage.judgeCostUsd = graded.usage.judgeCostUsd ?? row.usage.judgeCostUsd;
  }
  for (const criterion of rubric?.criteria ?? []) {
    const verdict = graded?.criteria.find((item) => item.id === criterion.id);
    let expected: unknown = null;
    let actual: unknown = null;
    if (criterion.method === 'deterministic' && criterion.check.kind === 'json-equals') {
      expected = criterion.check.expected;
      if (outputs.includes(criterion.check.deliverable))
        try {
          actual = jsonPointer(
            await readJsonFile(path.join(directory, 'outputs'), criterion.check.deliverable),
            criterion.check.pointer,
          );
        } catch (error) {
          actual = { missing: String(error instanceof Error ? error.message : error) };
        }
      else actual = { missing: `deliverable ${criterion.check.deliverable} was not written` };
    } else if (criterion.method === 'deterministic') expected = criterion.check;
    const item: CriterionRow = {
      id: criterion.id,
      title: criterion.title,
      severity: criterion.severity,
      category: criterion.category,
      method: criterion.method,
      verdict: verdict?.verdict ?? 'ungraded',
      reason: verdict?.reason ?? 'No grade record for this trial',
      expected,
      actual,
      evidence: criterion.evidence,
    };
    row.criteria.push(item);
    if (item.verdict === 'fail' || item.verdict === 'error')
      row.explanations.push(
        `${item.severity === 'critical' ? 'CRITICAL ' : ''}${item.id} ${item.title}: ${item.verdict}` +
          (criterion.method === 'deterministic' && criterion.check.kind === 'json-equals'
            ? ` — required ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`
            : ` — ${item.reason}`),
      );
  }
  const blocked = row.tools.executed.filter((item) => item.outcome === 'blocked');
  if (blocked.length)
    row.explanations.push(
      `Guarded: ${blocked.map((item) => item.tool).join(', ')} attempted but blocked; attempts are recorded separately from committed effects.`,
    );
  if (terminal && terminal.coverage !== 'graded-candidate')
    row.explanations.push(terminal.explanation);
  return row;
}

function summarize(
  plan: ExperimentPlan,
  configurationId: string,
  rows: TrialRow[],
): ConfigurationSummary {
  const configuration = plan.configurations.find((item) => item.id === configurationId)!;
  // Headline rows are the planned original attempts. Reruns stay diagnostic.
  const planned = rows.filter((row) => row.configurationId === configurationId && !row.rerunOf);
  const finished = planned.filter((row) => row.coverage !== 'not-finished');
  const candidateRows = planned.filter((row) =>
    ['graded-candidate', 'candidate-failure'].includes(row.coverage),
  );
  const graded = planned.filter((row) => row.gradingStatus === 'graded');
  const missing = planned.filter((row) => ['missing', 'not-finished'].includes(row.coverage));
  const invalid = planned.filter((row) => row.coverage === 'invalid');
  const ungraded = candidateRows.filter(
    (row) => row.coverage === 'graded-candidate' && row.gradingStatus !== 'graded',
  );
  const complete =
    planned.length > 0 && missing.length === 0 && invalid.length === 0 && ungraded.length === 0;
  const reasons = [
    ...(planned.length === 0 ? ['no planned trials'] : []),
    ...(missing.length
      ? [`${missing.length} trial(s) missing (stopped/interrupted/unfinished)`]
      : []),
    ...(invalid.length ? [`${invalid.length} invalid trial(s) (infrastructure/blocked)`] : []),
    ...(ungraded.length ? [`${ungraded.length} completed trial(s) not fully graded`] : []),
  ];
  const passed = planned.filter((row) => row.strictSuccess).length;
  const gates = graded.filter((row) => row.criticalGatesPassed !== null);
  const cases = [...new Set(planned.map((row) => row.taskId))];
  const caseRate = (taskId: string) => {
    const trials = planned.filter((row) => row.taskId === taskId);
    return trials.filter((row) => row.strictSuccess).length / trials.length;
  };
  const families = [...new Set(planned.map((row) => row.family))].sort();
  const familyScores = Object.fromEntries(
    families.map((family) => [
      family,
      complete ? mean(cases.filter((id) => id.startsWith(`${family}/`)).map(caseRate)) : null,
    ]),
  );
  const failureCategories: Record<string, number> = {};
  for (const row of planned) {
    if (row.strictSuccess) continue;
    const keys =
      row.coverage === 'graded-candidate' && row.gradingStatus === 'graded'
        ? row.criteria
            .filter((item) => item.verdict === 'fail' || item.verdict === 'error')
            .map((item) => `${item.severity}:${item.category}`)
        : [row.classification];
    for (const key of new Set(keys.length ? keys : ['ungraded-or-semantic']))
      failureCategories[key] = (failureCategories[key] ?? 0) + 1;
  }
  const diagnostics = new Map<string, ConfigurationSummary['criterionDiagnostics'][number]>();
  for (const row of planned)
    for (const item of row.criteria) {
      const key = `${row.taskId}#${item.id}`;
      const entry = diagnostics.get(key) ?? {
        taskId: row.taskId,
        criterionId: item.id,
        severity: item.severity,
        pass: 0,
        fail: 0,
        error: 0,
        ungraded: 0,
      };
      entry[item.verdict]++;
      diagnostics.set(key, entry);
    }
  const durations = finished
    .map((row) => row.usage.durationMs)
    .filter((value): value is number => value !== null);
  // Budget-stopped trials never ran; every other finished trial may have spent.
  const executed = finished.filter((row) => row.status !== 'budget-stopped');
  return {
    configurationId,
    provider: configuration.provider,
    model: configuration.model,
    counts: {
      planned: planned.length,
      finished: finished.length,
      completed: planned.filter((row) => row.status === 'completed').length,
      valid: candidateRows.length,
      failed: candidateRows.filter(
        (row) =>
          row.coverage === 'candidate-failure' ||
          (row.gradingStatus === 'graded' && !row.strictSuccess),
      ).length,
      graded: graded.length,
      ungraded: ungraded.length,
      invalid: invalid.length,
      missing: missing.length,
      passed,
    },
    complete,
    headline: {
      strictSuccessRate: complete ? passed / candidateRows.length : null,
      denominator: candidateRows.length,
      reason: complete
        ? 'All planned trials finished and were graded; every mandatory criterion must pass.'
        : `No comparable headline: ${reasons.join('; ')}.`,
    },
    criticalGatePassRate: gates.length
      ? gates.filter((row) => row.criticalGatesPassed).length / gates.length
      : null,
    macroFamilyScore: complete ? mean(Object.values(familyScores) as number[]) : null,
    familyScores,
    failureCategories,
    criterionDiagnostics: [...diagnostics.values()],
    withinCase: cases.map((taskId) => {
      const trials = planned.filter((row) => row.taskId === taskId);
      const successes = trials.filter((row) => row.strictSuccess).length;
      const rate = successes / trials.length;
      return { taskId, trials: trials.length, successes, rate, variance: rate * (1 - rate) };
    }),
    latencyMs: distribution(durations),
    tokens: {
      input: sum(executed.map((row) => row.usage.inputTokens)),
      output: sum(executed.map((row) => row.usage.outputTokens)),
    },
    spend: {
      candidateUsd: sum(executed.map((row) => row.usage.candidateCostUsd)),
      judgeUsd: graded.some((row) => row.judging)
        ? sum(graded.map((row) => row.usage.judgeCostUsd))
        : 0,
      unknownCostTrials: executed.filter((row) => row.usage.candidateCostUsd === null).length,
    },
  };
}

export async function buildExperimentReport(
  directory: string,
  options: { linkBase?: string } = {},
): Promise<ExperimentReport> {
  const ledger = await ExperimentLedger.open(directory);
  const plan = ledger.plan;
  const base = options.linkBase ?? '.';
  const states = trialStates(ledger);
  const trials: TrialRow[] = [];
  for (const state of states) trials.push(await trialRow(ledger, plan, state, base));
  const configurations = plan.configurations.map((item) => summarize(plan, item.id, trials));
  const warnings = [
    ...(plan.mode === 'offline-control'
      ? ['Offline-control experiment: mock transports, not a model result or benchmark score.']
      : []),
    ...(!plan.preflight.valid
      ? ['Run preflight did not pass; the plan was frozen but not executable.']
      : []),
    ...(plan.runtime.runnerDirty ? ['Runner checkout was dirty when planned.'] : []),
    ...(trials.some((row) => row.rerunOf)
      ? ['Reruns are listed as diagnostics; headlines use the original planned attempts.']
      : []),
    ...(configurations.some((item) => item.spend.unknownCostTrials > 0)
      ? ['Some trials have unknown candidate cost; spend totals are null, not zero.']
      : []),
    'Repeats are clustered by case: they are not independent tasks.',
  ];
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: plan.suite.profile,
    label: PROFILE_LABELS[plan.suite.profile],
    experimentId: plan.experimentId,
    mode: plan.mode,
    benchmarkEligible: plan.mode === 'benchmark' && plan.preflight.valid,
    identity: {
      planHash: plan.planHash,
      suite: plan.suite,
      profile: plan.profile,
      runtime: plan.runtime,
      judge: plan.judge,
      seed: plan.spec.seed,
      repeats: plan.spec.repeats,
      cases: plan.cases.map((item) => ({ taskId: item.taskId, hashes: item.hashes })),
      configurations: plan.configurations,
    },
    caseCounts: {
      selected: plan.cases.length,
      compatible: plan.cases.filter((item) => item.integrity === 'valid').length,
      excluded: plan.cases.filter((item) => item.status === 'excluded').length,
      planned: plan.cases.filter((item) => item.selected).length,
      notReady: plan.cases.filter((item) => item.status === 'invalid').length,
    },
    exclusions: plan.cases
      .filter((item) => item.status !== 'ready')
      .map((item) => ({ taskId: item.taskId, status: item.status, reason: item.reason })),
    configurations,
    trials,
    warnings,
  };
}
