import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JudgeProfileSchema, JudgeCalibrationSchema } from '#contracts/judge';
import { runCalibration } from '#src/grading/calibration-run';
import { calibrationProfileHash } from '#src/grading/judge';
import { inspectCalibration } from '#src/grading/adjudicate';
import { recordCalibration } from '#src/grading/calibration-record';
import { readJson, sha256 } from '#src/io';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test('a calibration run binds every unlabelled example to a two-judge receipt', async () => {
  const profile = JudgeProfileSchema.parse(
    await readJson(path.join(ROOT, 'profiles/judges/release-deepseek-qwen.json')),
  );
  await mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const outDir = await mkdtemp(path.join(ROOT, 'tmp/calibration-test-'));
  temporary.push(outDir);
  let requests = 0;
  // Mock judges: a scoped "fail" quoting the answer. Labels never reach them.
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    requests++;
    const body = String(init?.body);
    assert.ok(!/"label"|expected verdict/i.test(body), 'no label reaches a judge');
    const content = JSON.stringify({
      verdict: 'fail',
      explanation: 'Mock offline judge.',
      evidence: [{ kind: 'deliverable', ref: 'review.md', locator: 'text', quote: '##' }],
    });
    return new Response(
      JSON.stringify({
        id: 'mock',
        object: 'chat.completion',
        created: 1,
        model: 'mock',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const summary = await runCalibration(ROOT, {
    packPath: 'fixtures/judge-calibration/labelling-pack.json',
    profile,
    credentials: { deepseek: 'offline-key', qwen: 'offline-key' },
    outDir,
    maxUsd: 10,
    allowPaid: false,
    fetch,
  });
  assert.equal(summary.mode, 'offline-control');
  assert.equal(summary.results.length, 16);
  assert.ok(summary.results.every((item) => item.receipt && !item.skipped));
  assert.ok(requests >= 32, 'both judges per example');
  // Bind receipts into a calibration pack with placeholder labels: inspection
  // accepts every binding but refuses mock evidence and the unreviewed pack.
  const pack = (await readJson(
    path.join(ROOT, 'fixtures/judge-calibration/labelling-pack.json'),
  )) as { examples: { id: string; scenario: string; scope: unknown; evidenceHash: string }[] };
  const calibration = JudgeCalibrationSchema.parse({
    schemaVersion: '1.0.0',
    id: 'offline-binding-check',
    version: '1.0.0',
    profileHash: calibrationProfileHash(profile),
    review: { status: 'draft', reviewer: null, reviewedAt: null, notes: 'test' },
    examples: await Promise.all(
      pack.examples.map(async (example) => ({
        id: example.id,
        scenario: example.scenario,
        scope: example.scope,
        evidenceHash: example.evidenceHash,
        expected: 'fail',
        review: { status: 'draft', reviewer: null, reviewedAt: null, notes: 'test' },
        receiptPath: path
          .relative(ROOT, path.join(outDir, `${example.id}.json`))
          .replace(/\\/g, '/'),
        receiptHash: sha256(await readFile(path.join(outDir, `${example.id}.json`))),
        adjudicationPaths: [],
      })),
    ),
  });
  const inspected = await inspectCalibration(ROOT, calibration, profile);
  assert.equal(inspected.ready, false);
  assert.ok(inspected.pending.some((item) => /Mock judge evidence/.test(item)));
  assert.ok(inspected.pending.some((item) => /Calibration review is pending/.test(item)));
  // Spend is capped: a budget below one reservation runs nothing.
  const capped = await runCalibration(ROOT, {
    packPath: 'fixtures/judge-calibration/labelling-pack.json',
    profile,
    credentials: { deepseek: 'offline-key', qwen: 'offline-key' },
    outDir: path.join(outDir, 'capped'),
    maxUsd: 0.1,
    allowPaid: false,
    fetch,
  });
  assert.ok(capped.results.every((item) => item.skipped === 'CALIBRATION_BUDGET_EXHAUSTED'));
  // Recording binds every reviewer label to a copied receipt; a missing label
  // is refused, and mock evidence never makes the pack ready.
  const relative = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/');
  const labelsFile = path.join(outDir, 'labels.json');
  const labels = {
    schemaVersion: '1.0.0',
    pack: 'calibration-labelling-2026-10@1.0.0',
    reviewer: 'Synthetic test reviewer',
    reviewedAt: '2026-10-04T00:00:00Z',
    timestampNote: 'Test only; no human review.',
    labels: Object.fromEntries(pack.examples.map((example) => [example.id, 'fail'])),
  };
  await writeFile(labelsFile, JSON.stringify(labels));
  const recorded = await recordCalibration(ROOT, {
    packPath: 'fixtures/judge-calibration/labelling-pack.json',
    labelsPath: relative(labelsFile),
    receiptsDir: outDir,
    profile,
    outPath: relative(path.join(outDir, 'calibration.json')),
    receiptRoot: relative(path.join(outDir, 'bound')),
  });
  assert.equal(recorded.ready, false);
  assert.equal(recorded.examples.length, 16);
  assert.ok(recorded.pending.some((item) => /Mock judge evidence/.test(item)));
  const { [pack.examples[0]!.id]: _dropped, ...partial } = labels.labels;
  await writeFile(labelsFile, JSON.stringify({ ...labels, labels: partial }));
  await assert.rejects(
    recordCalibration(ROOT, {
      packPath: 'fixtures/judge-calibration/labelling-pack.json',
      labelsPath: relative(labelsFile),
      receiptsDir: outDir,
      profile,
      outPath: relative(path.join(outDir, 'calibration-2.json')),
      receiptRoot: relative(path.join(outDir, 'bound-2')),
    }),
    /CALIBRATION_LABELS_MISSING/,
  );
}, 120_000);
