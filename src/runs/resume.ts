import { randomUUID } from 'node:crypto';
import type { LedgerEvent, PlannedTrial, TrialStatusValue } from '#contracts/experiment';
import type { ExperimentLedger } from '#runs/artifacts';

export interface TrialState {
  trial: PlannedTrial;
  rerunOf: string | null;
  state: 'unstarted' | 'started' | 'finished';
  status: TrialStatusValue | null;
  reason: string | null;
  bundleHash: string | null;
  usage: Extract<LedgerEvent, { type: 'trial-finished' }>['usage'] | null;
  grades: Extract<LedgerEvent, { type: 'trial-graded' }>[];
}

// Rebuild every trial's state from the frozen plan plus the verified ledger.
// Planned trials and reruns are both kept; nothing is dropped or replaced.
export function trialStates(ledger: Pick<ExperimentLedger, 'plan' | 'all'>): TrialState[] {
  const states = new Map<string, TrialState>();
  const add = (trial: PlannedTrial, rerunOf: string | null) =>
    states.set(trial.trialId, {
      trial,
      rerunOf,
      state: 'unstarted',
      status: null,
      reason: null,
      bundleHash: null,
      usage: null,
      grades: [],
    });
  for (const trial of ledger.plan.trials) add(trial, null);
  for (const event of ledger.all) {
    if (event.type === 'rerun-planned') {
      if (states.has(event.trial.trialId)) throw new Error('RERUN_REUSES_TRIAL_ID');
      add(event.trial, event.rerunOf);
      continue;
    }
    if (!('trialId' in event)) continue;
    const state = states.get(event.trialId);
    if (!state) throw new Error(`LEDGER_UNKNOWN_TRIAL: ${event.trialId}`);
    if (event.type === 'trial-started') state.state = 'started';
    if (event.type === 'trial-finished') {
      state.state = 'finished';
      state.status = event.status;
      state.reason = event.reason;
      state.bundleHash = event.bundleHash;
      state.usage = event.usage;
    }
    if (event.type === 'trial-graded') state.grades.push(event);
  }
  return [...states.values()];
}

// Resume preserves interrupted work: a trial that started but never finished is
// recorded as `interrupted` (never rerun under its ID). Only unstarted trials remain.
export async function prepareResume(ledger: ExperimentLedger) {
  const interrupted: string[] = [];
  for (const state of trialStates(ledger))
    if (state.state === 'started') {
      await ledger.append({
        type: 'trial-finished',
        trialId: state.trial.trialId,
        status: 'interrupted',
        reason: 'Trial started but no terminal outcome was recorded before resume',
        usage: {
          inputTokens: null,
          outputTokens: null,
          candidateCostUsd: null,
          judgeCostUsd: null,
          durationMs: null,
        },
        bundleHash: null,
      });
      interrupted.push(state.trial.trialId);
    }
  const remaining = trialStates(ledger)
    .filter((state) => state.state === 'unstarted')
    .map((state) => state.trial)
    .sort((a, b) => a.sequence - b.sequence);
  return { interrupted, remaining };
}

// An explicit rerun is a new trial with a new ID that references the original.
// The original attempt, whatever its outcome, stays in the denominator.
export async function planRerun(ledger: ExperimentLedger, trialId: string, reason: string) {
  const states = trialStates(ledger);
  const original = states.find((state) => state.trial.trialId === trialId);
  if (!original) throw new Error(`UNKNOWN_TRIAL: ${trialId}`);
  if (original.state !== 'finished') throw new Error('RERUN_REQUIRES_FINISHED_ORIGINAL');
  const trial: PlannedTrial = {
    ...original.trial,
    trialId: `trial-${randomUUID()}`,
    sequence: Math.max(...states.map((state) => state.trial.sequence)) + 1,
  };
  await ledger.append({ type: 'rerun-planned', trial, rerunOf: trialId, reason });
  return trial;
}
