import { test, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ConfigSchema } from '#src/config';
import { generatedFiles } from '#fixtures/generate';
import { executeDocumentTrial } from '#runs/execute';
// Recorded reviews approve the committed packs; these gate tests generate an
// all-draft copy so the review gate itself stays exercised.
vi.mock('#fixtures/reviews', async (original) => ({
  ...(await original<typeof import('#fixtures/reviews')>()),
  caseReview: (_id: string, draft: unknown) => draft,
  fixtureReview: (_id: string, draft: unknown) => draft,
}));
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
test('paid execution requires opt-in and a full-suite review gate retains every selected case', async () => {
  await mkdir('tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/run-gates-'));
  temporary.push(root);
  for (const [relative, content] of await generatedFiles()) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
  await mkdir(path.join(root, 'profiles'));
  for (const profile of ['documents', 'fixed-tools', 'royal-eve'])
    await writeFile(
      path.join(root, `profiles/${profile}.json`),
      await readFile(`profiles/${profile}.json`),
    );
  // The D01 specimen now sits in the labelled development variant suite.
  const suite = 'suites/development-variants.json';
  const selected = JSON.parse(await readFile(path.join(root, suite), 'utf8')).cases.length;
  const task = 'offers/reconcile-quote-build-up/cedar';
  const config = ConfigSchema.parse({});
  await assert.rejects(
    executeDocumentTrial(root, task, suite, config, 'grading/verification.json', false),
    /PAID_EXECUTION_DISABLED/,
  );
  const result = await executeDocumentTrial(
    root,
    task,
    suite,
    config,
    'grading/verification.json',
    true,
  );
  assert.equal(result.status, 'blocked-input');
  assert.equal(result.preflight!.cases.length, selected);
  assert.ok(result.preflight!.cases.every((item) => item.reason?.includes('Human review')));
  const saved = JSON.parse(await readFile(path.join(result.directory, 'preflight.json'), 'utf8'));
  assert.equal(saved.cases.length, selected);
});
