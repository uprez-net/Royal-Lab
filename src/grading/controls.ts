import path from 'node:path';
import type { Task } from '#contracts/task';
import { ResultSchema, type CaseResult } from '#contracts/result';
import type { CaseControl } from '#contracts/authoring';
import { gradeDeterministic } from '#src/grading/deterministic';
import { securePath } from '#src/io';
import { validateTask } from '#tasks/validate';
import { visibleInput } from '#tasks/visible-input';

export interface ControlOutcome {
  controlId: string;
  kind: CaseControl['kind'];
  failureMode: string | null;
  matches: boolean;
  mismatches: { criterionId: string; expected: string; actual: string; reason: string }[];
  criticalGatesPassed: boolean | null;
}
export function completedExecution(
  task: Task,
  runId: string,
  artifacts: CaseResult['artifacts'],
  profile: 'documents' | 'fixed-tools' = 'documents',
) {
  return ResultSchema.parse({
    schemaVersion: '1.1.0',
    runId,
    taskId: task.id,
    taskVersion: task.version,
    profile,
    trial: 0,
    status: 'completed',
    reason: null,
    gradingStatus: 'ungraded',
    strictSuccess: false,
    criticalGatesPassed: null,
    criteria: [],
    outcomeId: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      candidateCostUsd: null,
      judgeCostUsd: null,
      durationMs: 0,
      toolAttempts: 0,
      toolExecutions: 0,
      committedEffects: 0,
    },
    artifacts,
  });
}
export function compareControl(control: CaseControl, graded: CaseResult): ControlOutcome {
  const mismatches = Object.entries(control.expected).flatMap(([criterionId, expected]) => {
    const actual = graded.criteria.find((criterion) => criterion.id === criterionId);
    return actual?.verdict === expected
      ? []
      : [
          {
            criterionId,
            expected,
            actual: actual?.verdict ?? 'missing',
            reason: actual?.reason ?? 'Criterion was not graded',
          },
        ];
  });
  return {
    controlId: control.id,
    kind: control.kind,
    failureMode: control.failureMode,
    matches: mismatches.length === 0,
    mismatches,
    criticalGatesPassed: graded.criticalGatesPassed,
  };
}
// Offline measurement-system check for a document case: no candidate, judge or
// network call. Semantic criteria stay ungraded; deterministic verdicts must
// equal the hidden expectation for every reference and negative control.
export async function gradeArtifactControls(root: string, task: Task) {
  const validated = await validateTask(root, task);
  if (!validated.controls || !validated.verification)
    throw new Error('CONTROLS_UNAVAILABLE: task schema 1.2.0 controls are required');
  const projection = await visibleInput(root, task);
  const sources = projection.files.map((file) => ({
    id: file.id,
    locators: file.units.map((unit) => unit.locator),
  }));
  const outcomes: ControlOutcome[] = [];
  for (const control of validated.controls.controls) {
    if (control.mode !== 'artifacts') continue;
    const outputRoot = await securePath(
      validated.directory,
      path.posix.join('grading/controls', control.id),
    );
    const graded = await gradeDeterministic(
      validated.rubric,
      outputRoot,
      completedExecution(task, `control-${control.id}`, control.outputs),
      { plan: validated.verification, sources, mode: 'offline-control' },
    );
    outcomes.push(compareControl(control, graded));
  }
  return { taskId: task.id, outcomes, valid: outcomes.every((outcome) => outcome.matches) };
}
