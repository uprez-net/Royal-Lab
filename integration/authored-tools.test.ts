import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { discover } from '#tasks/discover';
import { validateTask } from '#tasks/validate';
import { runTrajectoryControl } from '#src/grading/tool-controls';
import { AUTHORED_CASES } from '#fixtures/authoring/index';

// Executes every hidden fixed-tools trajectory control of the authored cases on
// an isolated synthetic database through the pinned canonical bridge, then grades
// independent state, trace and artifacts offline. Mocked transport only: these
// validate the measurement system, not a model.
const root = process.cwd();
const CONTROL =
  'postgresql://royal_lab:royal-lab-disposable-only@127.0.0.1:55432/royal_lab_control';
const cases = AUTHORED_CASES.map((make) => make()).filter((spec) => spec.profile === 'fixed-tools');
const selected = process.env.ROYAL_LAB_CASE_FILTER;
const rows = cases
  .filter((spec) => !selected || spec.id.includes(selected))
  .flatMap((spec) => spec.controls.map((control) => [spec.id, control.id] as const));

test.each(rows)('%s / %s produces its declared verdicts', async (taskId, controlId) => {
  const entry = (await discover(root)).find((item) => item.task.id === taskId)!;
  const directory = path.join(
    root,
    'tmp/authored-controls',
    `${taskId.replace(/\//g, '__')}__${controlId}__${randomUUID().slice(0, 8)}`,
  );
  await mkdir(path.dirname(directory), { recursive: true });
  const outcome = await runTrajectoryControl({
    root,
    task: entry.task,
    controlId,
    controlUrl: CONTROL,
    directory,
  });
  assert.equal(
    outcome.matches,
    true,
    `${taskId}/${controlId} status ${outcome.status} (expected ${outcome.expectedStatus}): ${JSON.stringify(outcome.mismatches, null, 2)} evidence ${directory}`,
  );
  // Independent evidence is saved for inspection without rerunning the control.
  for (const file of ['state.json', 'trace.jsonl', 'controller-events.json', 'control-grade.json'])
    assert.ok((await readFile(path.join(directory, file))).length > 0);
});

test('authored environments seed only fixture rows and leave no run databases behind', async () => {
  for (const spec of cases) {
    const entry = (await discover(root)).find((item) => item.task.id === spec.id)!;
    const validated = await validateTask(root, entry.task);
    assert.equal(validated.environment?.bridge.mode, 'benchmark');
    assert.equal(validated.environment?.operator.review.status, 'draft');
  }
  const observer = new Pool({ connectionString: CONTROL, max: 1 });
  try {
    const remaining = await observer.query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'royal_lab_run_%'",
    );
    assert.equal(remaining.rows.length, 0);
  } finally {
    await observer.end();
  }
});
