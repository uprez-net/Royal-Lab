import { ResultSchema, RunManifestSchema, type CaseResult, type RunManifest } from '#contracts/result';

export function accountResults(manifest: RunManifest, results: CaseResult[]) {
  RunManifestSchema.parse(manifest);
  results.forEach((result) => ResultSchema.parse(result));
  const key = (taskId: string, trial: number) => `${taskId}:${trial}`;
  const selected = new Set(manifest.cases.map((c) => key(c.taskId, c.trial)));
  const seen = new Set<string>();
  for (const result of results) {
    const id = key(result.taskId, result.trial);
    if (!selected.has(id) || seen.has(id) || result.runId !== manifest.runId || result.profile !== manifest.profile) throw new Error(`Unexpected/duplicate result: ${id}`);
    seen.add(id);
  }
  const rows = manifest.cases.map((item) => {
    const result = results.find((r) => key(r.taskId, r.trial) === key(item.taskId, item.trial));
    return { ...item, status: result?.status ?? item.status, strictSuccess: result?.strictSuccess ?? false,
      gradingStatus: result?.gradingStatus ?? 'ungraded', missingResult: !result };
  });
  const valid = rows.filter((r) => !['excluded', 'invalid', 'infrastructure-error'].includes(r.status));
  const graded = rows.filter((r) => r.gradingStatus === 'graded');
  const complete = rows.every((r) => r.status === 'excluded' || (!r.missingResult &&
    ['completed', 'candidate-failure', 'budget-exhausted'].includes(r.status) && r.gradingStatus === 'graded'));
  return { rows, counts: { selected: rows.length, excluded: rows.filter((r) => r.status === 'excluded').length,
    valid: valid.length, invalid: rows.filter((r) => r.status === 'invalid').length,
    infrastructureErrors: rows.filter((r) => r.status === 'infrastructure-error').length,
    missingResults: rows.filter((r) => r.missingResult && r.status !== 'excluded').length,
    completed: rows.filter((r) => r.status === 'completed').length,
    failed: rows.filter((r) => ['candidate-failure', 'budget-exhausted'].includes(r.status) ||
      (r.gradingStatus === 'graded' && !r.strictSuccess)).length,
    ungraded: rows.filter((r) => r.status !== 'excluded' && r.gradingStatus !== 'graded').length,
    graded: graded.length, passed: rows.filter((r) => r.strictSuccess).length },
    comparable: complete, strictSuccessRate: complete && valid.length > 0 ? rows.filter((r) => r.strictSuccess).length / valid.length : null };
}
