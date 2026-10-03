import type { z } from 'zod';
import type {
  ExperimentBudget,
  ExperimentConfiguration,
  SpendEstimate,
  TrialStatusValue,
  UsageAssumptions,
} from '#contracts/experiment';
import type { Limits } from '#contracts/common';

type Budget = z.infer<typeof ExperimentBudget>;
type Assumptions = z.infer<typeof UsageAssumptions>;
type Pricing = ExperimentConfiguration['pricing'];
type JudgePricing = { inputUsdPerMillion: number; outputUsdPerMillion: number } | null;

const usd = (tokens: number, perMillion: number) => (tokens * perMillion) / 1_000_000;
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

// The worst-case candidate charge a trial may incur: the declared token ceilings at
// the configuration's frozen pricing, capped by the task and experiment ceilings.
export function trialCandidateCeiling(
  limits: z.infer<typeof Limits>,
  pricing: Pricing,
  budget: Budget,
) {
  const tokenBound =
    usd(limits.maxInputTokens, pricing.inputUsdPerMillion) +
    usd(limits.maxOutputTokens, pricing.outputUsdPerMillion);
  return round(Math.min(tokenBound, limits.maxCostUsd, budget.perTrialCandidateUsd));
}
export function estimateSpend(input: {
  trials: { configurationId: string; limits: z.infer<typeof Limits>; semanticCriteria: number }[];
  configurations: ExperimentConfiguration[];
  budget: Budget;
  assumptions: Assumptions;
  judges: { count: number; pricing: JudgePricing[] } | null;
}): z.infer<typeof SpendEstimate> {
  let expectedCandidate = 0;
  let boundedCandidate = 0;
  let judgeCalls = 0;
  let expectedJudge: number | null = 0;
  let boundedJudge = 0;
  const a = input.assumptions;
  for (const trial of input.trials) {
    const configuration = input.configurations.find((item) => item.id === trial.configurationId);
    if (!configuration) throw new Error(`UNKNOWN_CONFIGURATION: ${trial.configurationId}`);
    const p = configuration.pricing;
    const uncached = Math.max(
      0,
      a.candidateInputTokensPerTrial - a.candidateCachedInputTokensPerTrial,
    );
    expectedCandidate +=
      usd(uncached, p.inputUsdPerMillion) +
      usd(
        a.candidateCachedInputTokensPerTrial,
        p.cachedInputUsdPerMillion ?? p.inputUsdPerMillion,
      ) +
      usd(a.candidateOutputTokensPerTrial, p.outputUsdPerMillion);
    boundedCandidate += trialCandidateCeiling(trial.limits, p, input.budget);
    if (input.judges) {
      const calls = trial.semanticCriteria * input.judges.count;
      judgeCalls += calls;
      if (trial.semanticCriteria > 0) boundedJudge += input.budget.perTrialJudgeUsd;
      for (const pricing of input.judges.pricing)
        if (pricing === null) expectedJudge = null;
        else if (expectedJudge !== null)
          expectedJudge +=
            trial.semanticCriteria *
            (usd(a.judgeInputTokensPerCall, pricing.inputUsdPerMillion) +
              usd(a.judgeOutputTokensPerCall, pricing.outputUsdPerMillion));
    }
  }
  const assumptions = [
    `Candidate tokens per trial: ${a.candidateInputTokensPerTrial} input (${a.candidateCachedInputTokensPerTrial} cached), ${a.candidateOutputTokensPerTrial} output.`,
    `Judge tokens per call: ${a.judgeInputTokensPerCall} input, ${a.judgeOutputTokensPerCall} output.`,
    'Bounded spend uses declared token/cost ceilings at frozen pricing; provider accounting stays authoritative.',
    ...(expectedJudge === null
      ? ['Judge pricing is not pinned: expected judge spend is unknown, not zero.']
      : []),
    ...(input.judges ? [] : ['No judge profile: semantic criteria stay ungraded; no judge calls.']),
    ...input.configurations
      .filter(
        (item) => item.pricing.inputUsdPerMillion === 0 && item.pricing.outputUsdPerMillion === 0,
      )
      .map(
        (item) =>
          `Configuration ${item.id} has zero pricing: its spend bound is a placeholder, not a ceiling.`,
      ),
  ];
  return {
    candidateTrials: input.trials.length,
    judgeCalls,
    expectedCandidateUsd: round(expectedCandidate),
    expectedJudgeUsd: expectedJudge === null ? null : round(expectedJudge),
    boundedCandidateUsd: round(boundedCandidate),
    boundedJudgeUsd: round(boundedJudge),
    withinBudget:
      round(boundedCandidate) <= input.budget.totalCandidateUsd &&
      round(boundedJudge) <= input.budget.totalJudgeUsd,
    assumptions,
  };
}

// Aggregate candidate ledger. A trial whose cost is unknown (no usage, failed
// before a response, interrupted) is never counted as $0: it is charged its
// worst-case per-trial reservation as an upper bound and reported as unknown.
// Without a positive bound, unknown usage stops all further paid admission.
export class SpendLedger {
  knownCandidateUsd = 0;
  unknownCandidateTrials = 0;
  unknownCandidateBoundUsd = 0;
  private unbounded = false;
  private reserved = 0;
  readonly started: number;
  constructor(
    readonly budget: Budget,
    private readonly now: () => number = Date.now,
  ) {
    this.started = now();
  }
  get committedUpperBoundUsd() {
    return round(this.knownCandidateUsd + this.unknownCandidateBoundUsd);
  }
  admit(reservation: number):
    | { ok: true }
    | {
        ok: false;
        classification: 'candidate-budget' | 'wall-clock' | 'unknown-usage';
        reason: string;
      } {
    if (this.unbounded)
      return {
        ok: false,
        classification: 'unknown-usage',
        reason:
          'A trial has unknown candidate usage with no spend bound; further paid work is not authorised',
      };
    if (this.now() - this.started >= this.budget.maxWallClockMs)
      return {
        ok: false,
        classification: 'wall-clock',
        reason: 'Experiment wall-clock ceiling reached',
      };
    if (
      this.committedUpperBoundUsd + this.reserved + reservation >
      this.budget.totalCandidateUsd + 1e-9
    )
      return {
        ok: false,
        classification: 'candidate-budget',
        reason: `Projected next trial ($${reservation.toFixed(4)}) would exceed the remaining candidate budget`,
      };
    this.reserved += reservation;
    return { ok: true };
  }
  // `reservation` is the trial's worst-case bound; `actual` its known cost or null.
  settle(reservation: number, actual: number | null, admitted = true) {
    if (admitted) this.reserved = Math.max(0, this.reserved - reservation);
    if (actual !== null) this.knownCandidateUsd = round(this.knownCandidateUsd + actual);
    else if (reservation > 0) {
      this.unknownCandidateTrials++;
      this.unknownCandidateBoundUsd = round(this.unknownCandidateBoundUsd + reservation);
    } else this.unbounded = true;
  }
}

// Every terminal state names its denominator consequence explicitly.
export type Coverage =
  'graded-candidate' | 'candidate-failure' | 'invalid' | 'missing' | 'excluded';
export function classifyTermination(status: TrialStatusValue): {
  classification: string;
  coverage: Coverage;
  explanation: string;
} {
  switch (status) {
    case 'completed':
      return {
        classification: 'completed',
        coverage: 'graded-candidate',
        explanation: 'Candidate finished; correctness depends on grading, not completion.',
      };
    case 'candidate-failure':
      return {
        classification: 'candidate-failure',
        coverage: 'candidate-failure',
        explanation: 'Counts in the denominator as a failed trial.',
      };
    case 'budget-exhausted':
      return {
        classification: 'candidate-resource-ceiling',
        coverage: 'candidate-failure',
        explanation:
          'The candidate exhausted its per-trial turn/token/time/cost ceiling; counts as a failed trial.',
      };
    case 'budget-stopped':
      return {
        classification: 'experiment-resource-ceiling',
        coverage: 'missing',
        explanation:
          'Never started because an experiment ceiling would be exceeded; coverage is incomplete and no headline is comparable.',
      };
    case 'interrupted':
      return {
        classification: 'interrupted',
        coverage: 'missing',
        explanation:
          'Started but never finished; preserved as missing coverage and never silently rerun under the same ID.',
      };
    case 'infrastructure-error':
      return {
        classification: 'infrastructure-error',
        coverage: 'invalid',
        explanation:
          'Harness/provider/controller failure; not a candidate result and coverage is incomplete.',
      };
    case 'blocked-input':
    case 'invalid':
      return {
        classification: 'blocked-input',
        coverage: 'invalid',
        explanation: 'Input or review readiness blocked execution; no candidate request was made.',
      };
    case 'excluded':
      return {
        classification: 'excluded',
        coverage: 'excluded',
        explanation: 'Explicitly excluded from this selection; reported with its own reason.',
      };
    default:
      return {
        classification: 'not-finished',
        coverage: 'missing',
        explanation: 'No terminal outcome recorded.',
      };
  }
}
