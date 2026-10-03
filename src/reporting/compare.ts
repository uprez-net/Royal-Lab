import { createHash } from 'node:crypto';
import { stableJson } from '#src/environments/session';
import type { ExperimentReport, TrialRow } from '#reporting/report';

export interface Arm {
  report: ExperimentReport;
  configurationId: string;
}
export interface Comparison {
  schemaVersion: '1.0.0';
  status: 'formal' | 'exploratory';
  label: string;
  compatible: boolean;
  mismatches: string[];
  arms: {
    experimentId: string;
    configurationId: string;
    model: string;
    strictSuccessRate: number | null;
    complete: boolean;
  }[];
  pairedCases: number;
  unpairedCases: string[];
  meanDifference: number | null;
  interval95: [number, number] | null;
  bootstrap: { iterations: number; seed: string; method: string };
  perCase: { taskId: string; a: number; b: number; trialsA: number; trialsB: number }[];
  wins: number;
  losses: number;
  ties: number;
  ranking: 'a' | 'b' | 'no-difference' | null;
  notes: string[];
}

// Everything that changes what a score means must match for a formal comparison.
export function compatibility(a: ExperimentReport, b: ExperimentReport) {
  const mismatches: string[] = [];
  const check = (name: string, left: unknown, right: unknown) => {
    if (stableJson(left ?? null) !== stableJson(right ?? null)) mismatches.push(name);
  };
  check('profile kind', a.kind, b.kind);
  check('suite id/version/hash', a.identity.suite, b.identity.suite);
  check('profile hash', a.identity.profile.hash, b.identity.profile.hash);
  check('system prompt', a.identity.profile.systemPromptHash, b.identity.profile.systemPromptHash);
  check('tool schemas', a.identity.profile.toolSchemaHash, b.identity.profile.toolSchemaHash);
  check('parser profile', a.identity.profile.parserProfile, b.identity.profile.parserProfile);
  check('product pin', a.identity.runtime.guriRevision, b.identity.runtime.guriRevision);
  check('judge profile', a.identity.judge?.profileHash, b.identity.judge?.profileHash);
  check('repeats', a.identity.repeats, b.identity.repeats);
  const cases = (report: ExperimentReport) =>
    Object.fromEntries(report.identity.cases.map((item) => [item.taskId, item.hashes]));
  const left = cases(a);
  const right = cases(b);
  for (const id of new Set([...Object.keys(left), ...Object.keys(right)]))
    check(`case ${id} (task/fixture/rubric/policy/sources/verifier)`, left[id], right[id]);
  if (a.mode !== 'benchmark' || b.mode !== 'benchmark') mismatches.push('non-benchmark mode');
  if (!a.benchmarkEligible || !b.benchmarkEligible)
    mismatches.push('run preflight did not pass for both experiments');
  return mismatches;
}

// Deterministic SHA-256 counter stream for reproducible resampling.
function random(seed: string) {
  let counter = 0;
  return () =>
    createHash('sha256').update(`${seed}:${counter++}`).digest().readUInt32BE(0) / 2 ** 32;
}
const rate = (rows: TrialRow[]) => rows.filter((row) => row.strictSuccess).length / rows.length;

// Paired by case, clustered by repeats: resample cases, then resample each arm's
// repeats within the case. Repeats are never treated as new independent tasks.
export function compare(
  a: Arm,
  b: Arm,
  options: { exploratory?: boolean; iterations?: number; seed?: string } = {},
): Comparison {
  const mismatches = a.report === b.report ? [] : compatibility(a.report, b.report);
  const summary = (arm: Arm) => {
    const found = arm.report.configurations.find(
      (item) => item.configurationId === arm.configurationId,
    );
    if (!found) throw new Error(`UNKNOWN_CONFIGURATION: ${arm.configurationId}`);
    return found;
  };
  const sa = summary(a);
  const sb = summary(b);
  if (a.report === b.report && a.configurationId === b.configurationId)
    throw new Error('COMPARE_SAME_ARM');
  const incomplete = [sa, sb].filter((item) => !item.complete).map((item) => item.configurationId);
  if (incomplete.length) mismatches.push(`incomplete coverage: ${incomplete.join(', ')}`);
  if (a.report === b.report && !a.report.benchmarkEligible)
    mismatches.push('non-benchmark or preflight-blocked experiment');
  if (mismatches.length && !options.exploratory)
    throw new Error(
      `INCOMPATIBLE_COMPARISON: ${mismatches.join('; ')}. Use --exploratory for a labelled, unranked diagnostic.`,
    );
  // Only graded candidate trials from the planned attempts contribute outcomes.
  const rows = (arm: Arm) =>
    arm.report.trials.filter(
      (row) =>
        row.configurationId === arm.configurationId &&
        !row.rerunOf &&
        ['graded-candidate', 'candidate-failure'].includes(row.coverage),
    );
  const ra = rows(a);
  const rb = rows(b);
  const casesA = new Set(ra.map((row) => row.taskId));
  const casesB = new Set(rb.map((row) => row.taskId));
  const paired = [...casesA].filter((id) => casesB.has(id)).sort();
  const unpaired = [...new Set([...casesA, ...casesB])].filter((id) => !paired.includes(id));
  const perCase = paired.map((taskId) => {
    const ta = ra.filter((row) => row.taskId === taskId);
    const tb = rb.filter((row) => row.taskId === taskId);
    return { taskId, a: rate(ta), b: rate(tb), trialsA: ta.length, trialsB: tb.length };
  });
  const iterations = options.iterations ?? 2000;
  const seed = options.seed ?? 'royal-lab-compare-1';
  let meanDifference: number | null = null;
  let interval: [number, number] | null = null;
  if (perCase.length) {
    meanDifference = perCase.reduce((total, item) => total + (item.b - item.a), 0) / perCase.length;
    const next = random(seed);
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      let total = 0;
      for (let j = 0; j < paired.length; j++) {
        const taskId = paired[Math.floor(next() * paired.length)]!;
        const resample = (list: TrialRow[]) => {
          const trials = list.filter((row) => row.taskId === taskId);
          let successes = 0;
          for (let k = 0; k < trials.length; k++)
            if (trials[Math.floor(next() * trials.length)]!.strictSuccess) successes++;
          return successes / trials.length;
        };
        total += resample(rb) - resample(ra);
      }
      samples.push(total / paired.length);
    }
    samples.sort((x, y) => x - y);
    interval = [
      samples[Math.floor(0.025 * (iterations - 1))]!,
      samples[Math.ceil(0.975 * (iterations - 1))]!,
    ];
  }
  const formal = mismatches.length === 0;
  const wins = perCase.filter((item) => item.b > item.a).length;
  const losses = perCase.filter((item) => item.b < item.a).length;
  return {
    schemaVersion: '1.0.0',
    status: formal ? 'formal' : 'exploratory',
    label: formal
      ? `${a.report.label} comparison`
      : `EXPLORATORY ${a.report.label} comparison — not a benchmark ranking`,
    compatible: formal,
    mismatches,
    arms: [
      [a, sa],
      [b, sb],
    ].map(([arm, item]) => ({
      experimentId: (arm as Arm).report.experimentId,
      configurationId: (arm as Arm).configurationId,
      model: (item as typeof sa).model,
      strictSuccessRate: (item as typeof sa).headline.strictSuccessRate,
      complete: (item as typeof sa).complete,
    })),
    pairedCases: perCase.length,
    unpairedCases: unpaired,
    meanDifference,
    interval95: interval,
    bootstrap: {
      iterations,
      seed,
      method: 'paired case bootstrap with clustered repeat resampling',
    },
    perCase,
    wins,
    losses,
    ties: perCase.length - wins - losses,
    ranking:
      !formal || !interval ? null : interval[0] > 0 ? 'b' : interval[1] < 0 ? 'a' : 'no-difference',
    notes: [
      'Difference is arm B minus arm A in per-case strict success rate.',
      'Different profiles (Documents, Fixed tools, Royal Eve) are never pooled or ranked together.',
      ...(unpaired.length
        ? ['Unpaired cases are listed and excluded from the paired statistic.']
        : []),
    ],
  };
}
