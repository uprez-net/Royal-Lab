import { afterEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskSchema, SuiteSchema } from '#contracts/task';
import { RelativePath, Review } from '#contracts/common';
import { RubricSchema } from '#contracts/rubric';
import { ResultSchema, type CaseResult, type RunManifest } from '#contracts/result';
import { ConfigSchema, loadConfig, redact, DEFAULT_LIMITS } from '#src/config';
import { generatedFiles, makeWorld } from '#fixtures/generate';
import { lintWorld, scanText } from '#fixtures/lint';
import { sydneyTime } from '#fixtures/clock';
import { discover } from '#tasks/discover';
import { preflight, validateTask, validateArtifact } from '#tasks/validate';
import { visibleInput } from '#tasks/visible-input';
import { accountResults } from '#runs/accounting';
import { jsonText, sha256, securePath, readJson } from '#src/io';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function workspace() {
  const parent = path.join(ROOT, 'tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'foundation-'));
  temporary.push(root);
  for (const [relative, content] of await generatedFiles()) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), content);
  }
  await mkdir(path.join(root, 'profiles'));
  for (const profile of ['documents', 'fixed-tools', 'royal-eve'])
    await writeFile(
      path.join(root, `profiles/${profile}.json`),
      await readFile(path.join(ROOT, `profiles/${profile}.json`)),
    );
  return root;
}
async function edit(root: string, relative: string, mutate: (value: any) => void) {
  const value = await readJson(path.join(root, relative));
  mutate(value);
  await writeFile(path.join(root, relative), jsonText(value));
}
// The original D01 specimen; superseded by an authored core case, it now sits
// in the labelled development variant suite.
const TASK = 'offers/reconcile-quote-build-up/cedar';
const SUITE = 'suites/development-variants.json';
describe('suite integrity and candidate isolation', () => {
  test('every generated suite validates offline but execution preflight rejects drafts', async () => {
    const root = await workspace();
    const suites = [...(await generatedFiles()).keys()].filter((file) =>
      file.startsWith('suites/'),
    );
    assert.ok(
      suites.includes('suites/development.json') && suites.includes('suites/held-out.json'),
    );
    for (const file of suites) {
      const report = await preflight(root, file);
      assert.equal(report.valid, true, `${file}: ${JSON.stringify(report.errors)}`);
      assert.ok(report.cases.length > 0);
      const run = await preflight(root, file, true);
      assert.equal(run.valid, false);
      assert.ok(
        run.cases.every((item) => item.reason?.includes('Human review')),
        file,
      );
    }
  });
  test('candidate projection cannot serialize hidden fixtures, rubric or provenance', async () => {
    const root = await workspace();
    const { task } = (await discover(root)).find((x) => x.task.id === TASK)!;
    const projected = await visibleInput(root, task);
    const text = JSON.stringify(projected);
    for (const hidden of [
      'expectedFacts',
      'fixtureHash',
      'rubricHash',
      'provenanceHash',
      'passIf',
      'failIf',
      'reviewer',
      'policy-decision',
    ])
      assert.ok(!text.includes(hidden), hidden);
    assert.deepEqual(
      projected.files.map((x) => x.path),
      ['documents/source.json', 'policies/business.md'],
    );
    assert.ok(text.includes('Cedar Lantern Homes'));
  });
  test('a missing selected case is invalid and retained in the denominator', async () => {
    const root = await workspace();
    const selected = SuiteSchema.parse(await readJson(path.join(root, 'suites/development.json')));
    await edit(root, 'suites/development.json', (suite) => suite.cases.push('offers/missing'));
    const report = await preflight(root, 'suites/development.json');
    assert.equal(report.valid, false);
    assert.equal(report.cases.length, selected.cases.length + 1);
    assert.equal(report.cases.at(-1)?.status, 'invalid');
  });
  test('duplicate selected IDs and paths cannot shrink a suite silently', async () => {
    const root = await workspace();
    await edit(root, 'suites/development.json', (suite) => suite.cases.push(suite.cases[0]));
    await assert.rejects(preflight(root, 'suites/development.json'), /Duplicate selected/);
  });
  test('altered source bytes fail the frozen hash', async () => {
    const root = await workspace();
    await writeFile(path.join(root, `tasks/${TASK}/documents/source.json`), '{"tampered":true}');
    const report = await preflight(root, SUITE);
    assert.equal(report.valid, false);
    assert.match(report.cases.find((x) => x.taskId === TASK)!.reason!, /Input hash mismatch/);
  });
  test('hidden-directory input is refused even when the author supplies a valid hash', async () => {
    const root = await workspace();
    const { task } = (await discover(root)).find((x) => x.task.id === TASK)!;
    task.inputs[0]!.path = 'grading/rubric.json';
    task.inputs[0]!.sha256 = task.rubricHash;
    await assert.rejects(validateTask(root, task), /Visible input outside/);
  });
  test('missing fixtures, unknown criterion sources and duplicate criterion IDs are rejected', async () => {
    const root = await workspace();
    const { task } = (await discover(root)).find((x) => x.task.id === TASK)!;
    const rubricFile = path.join(root, `tasks/${TASK}/grading/rubric.json`);
    const rubric = RubricSchema.parse(await readJson(rubricFile));
    rubric.criteria[0]!.evidence[0]!.sourceId = 'nonexistent';
    await writeFile(rubricFile, jsonText(rubric));
    task.rubricHash = sha256(jsonText(rubric));
    await assert.rejects(validateTask(root, task), /Unknown evidence source/);
    rubric.criteria[0]!.evidence[0]!.sourceId = 'source';
    rubric.criteria.push(rubric.criteria[0]!);
    await writeFile(rubricFile, jsonText(rubric));
    task.rubricHash = sha256(jsonText(rubric));
    await assert.rejects(validateTask(root, task), /Duplicate criterion/);
    await rm(path.join(root, `tasks/${TASK}/grading/fixture.json`));
    await assert.rejects(validateTask(root, task), /ENOENT/);
  });
  test('unknown deliverables are rejected independently of rubric shape', async () => {
    const root = await workspace();
    const { task } = (await discover(root)).find((x) => x.task.id === TASK)!;
    const rubric = RubricSchema.parse(
      await readJson(path.join(root, `tasks/${TASK}/grading/rubric.json`)),
    );
    rubric.criteria[0]!.deliverables.push('unknown.md');
    await writeFile(path.join(root, `tasks/${TASK}/grading/rubric.json`), jsonText(rubric));
    task.rubricHash = sha256(jsonText(rubric));
    await assert.rejects(validateTask(root, task), /Unknown criterion deliverable/);
  });
  test('unsupported declared tool/version invalidates selected case before execution', async () => {
    const root = await workspace();
    await edit(root, `tasks/${TASK}/task.json`, (task) =>
      task.tools.push({ name: 'shell', version: '1.0.0' }),
    );
    const report = await preflight(root, SUITE);
    assert.equal(report.valid, false);
    assert.match(report.cases.find((x) => x.taskId === TASK)!.reason!, /Unsupported tool/);
  });
  test('profile exclusions remain explicit and an all-excluded selection is invalid', async () => {
    const root = await workspace();
    // A specimen-only selection; authored 1.2.0 cases cannot change profile
    // without declaring a seeded environment.
    const only = 'suites/specimen-only.json';
    await writeFile(
      path.join(root, only),
      jsonText({
        ...SuiteSchema.parse(await readJson(path.join(root, SUITE))),
        id: 'specimen-only',
        cases: [TASK],
      }),
    );
    await edit(root, `tasks/${TASK}/task.json`, (task) => {
      task.profiles = ['fixed-tools'];
    });
    const report = await preflight(root, only);
    assert.equal(report.valid, false);
    assert.equal(report.cases.length, 1);
    assert.ok(report.cases.every((c) => c.status === 'excluded'));
  });
  test('cross-split world reuse is detected', async () => {
    const root = await workspace();
    await edit(root, 'suites/held-out.json', (suite) => suite.cases.push(TASK));
    const report = await preflight(root, 'suites/development.json');
    assert.ok(report.errors.includes('Development/held-out world leakage'));
  });
  test('task identity follows its directory', async () => {
    const root = await workspace();
    await edit(root, `tasks/${TASK}/task.json`, (task) => {
      task.id = 'offers/another-case';
    });
    await assert.rejects(discover(root), /ID\/path mismatch/);
  });
});
describe('paths, provenance and fixtures', () => {
  test('portable paths reject traversal, Windows escape routes and encoded traversal', () => {
    for (const unsafe of [
      '../x',
      '/x',
      'C:/x',
      'x\\y',
      'x/../y',
      'x//y',
      'x/%2e%2e/y',
      'x:file',
      'CON.txt',
      'x/aux',
      'x.',
    ])
      assert.equal(RelativePath.safeParse(unsafe).success, false, unsafe);
    assert.equal(RelativePath.safeParse('documents/source.json').success, true);
  });
  test('a directory symlink cannot expose files outside the case', async () => {
    const root = await workspace();
    await symlink(
      path.join(root, 'fixtures'),
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(securePath(root, 'escape/worlds/cedar-world.json'), /Symlink forbidden/);
  });
  test('human approval requires reviewer/time and is never generated', () => {
    assert.equal(
      Review.safeParse({ status: 'approved', reviewer: null, reviewedAt: null, notes: '' }).success,
      false,
    );
    assert.equal(makeWorld('development').review.status, 'draft');
  });
  test('two worlds are deterministic and structurally different with coherent references', () => {
    assert.deepEqual(makeWorld('development'), makeWorld('development'));
    const dev = makeWorld('development');
    const held = makeWorld('held-out');
    assert.notEqual(dev.entities.length, held.entities.length);
    assert.notEqual(dev.scenario, held.scenario);
    assert.equal(dev.entities.filter((e) => e.kind === 'project').length, 1);
    assert.equal(held.entities.filter((e) => e.kind === 'project').length, 2);
    assert.deepEqual(lintWorld(dev), []);
    assert.deepEqual(lintWorld(held), []);
    assert.equal(dev.facts.contractCents, 66457600);
    assert.equal(held.facts.contractCents, 48048000);
  });
  test('Sydney DST is frozen and clock does not depend on local machine timezone', () => {
    assert.deepEqual(
      sydneyTime({ instant: '2026-10-03T15:59:00Z', timezone: 'Australia/Sydney' }),
      { localDate: '2026-10-04', localTime: '01:59:00', offset: 'GMT+10:00' },
    );
    assert.deepEqual(
      sydneyTime({ instant: '2026-10-03T16:00:00Z', timezone: 'Australia/Sydney' }),
      { localDate: '2026-10-04', localTime: '03:00:00', offset: 'GMT+11:00' },
    );
  });
  test('privacy lint detects identifiers/secrets without returning the values', () => {
    assert.ok(scanText('person@real-domain.com').includes('non-synthetic-email'));
    assert.deepEqual(scanText('person@fiction.example'), []);
    assert.ok(scanText('sk_' + 'x'.repeat(30)).includes('secret-pattern'));
    assert.ok(scanText('ABN: 12345678901').includes('sensitive-identifier'));
    const world = makeWorld('development');
    world.entities[0]!.references.push('missing');
    assert.ok(lintWorld(world).some((f) => f.startsWith('unknown-reference')));
  });
  test('scope preserves all 28 definitions and all 57 pinned tool files', async () => {
    const catalogue = (await readJson(path.join(ROOT, 'scope/catalogue.json'))) as {
      definitions: { id: string }[];
    };
    const inventory = (await readJson(path.join(ROOT, 'scope/tools.json'))) as {
      tools: { sourcePath: string; runtimeVerified: boolean }[];
    };
    assert.equal(catalogue.definitions.length, 28);
    assert.equal(new Set(catalogue.definitions.map((x) => x.id)).size, 28);
    for (const id of ['D13', 'D14', 'D15', 'D16'])
      assert.ok(catalogue.definitions.some((x) => x.id === id));
    assert.equal(inventory.tools.length, 57);
    assert.equal(new Set(inventory.tools.map((x) => x.sourcePath)).size, 57);
    assert.ok(inventory.tools.every((x) => x.runtimeVerified === false));
  });
});
describe('configuration and immutable result accounting', () => {
  test('configuration ignores ambient application credentials and redacts recursive secrets', async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://unsafe';
    try {
      assert.deepEqual(await loadConfig(), ConfigSchema.parse({}));
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
    assert.deepEqual(
      redact({
        apiKey: 'secret',
        nested: { fixtureDatabaseUrl: 'postgres://u:p@host/db', token: 'secret' },
      }),
      { apiKey: '[REDACTED]', nested: { fixtureDatabaseUrl: '[REDACTED]', token: '[REDACTED]' } },
    );
    assert.equal(ConfigSchema.safeParse({ DATABASE_URL: 'unsafe' }).success, false);
  });
  const hash = 'a'.repeat(64);
  function manifest(): RunManifest {
    return {
      schemaVersion: '1.0.0',
      runId: 'example',
      createdAt: '2026-10-01T00:00:00Z',
      suiteId: 'example',
      suiteVersion: '1.0.0',
      suiteHash: hash,
      profile: 'documents',
      profileHash: hash,
      policyHash: hash,
      systemPromptHash: hash,
      toolSchemaHash: hash,
      parserHash: hash,
      fixturesHash: hash,
      operatorScriptHash: hash,
      guriRevision: null,
      candidate: { provider: 'example', model: 'fictional-model', parameters: {} },
      judges: [],
      pricingSnapshot: { version: '1.0.0', asOf: '2026-10-01T00:00:00Z', sha256: hash },
      limits: DEFAULT_LIMITS,
      repeats: 2,
      cases: [0, 1].map((trial) => ({
        taskId: TASK,
        trial,
        taskHash: hash,
        status: 'pending',
        reason: null,
      })),
    };
  }
  function result(trial = 0): CaseResult {
    return ResultSchema.parse({
      schemaVersion: '1.0.0',
      runId: 'example',
      taskId: TASK,
      taskVersion: '1.0.0',
      profile: 'documents',
      trial,
      status: 'completed',
      reason: null,
      gradingStatus: 'graded',
      strictSuccess: true,
      criticalGatesPassed: true,
      outcomeId: 'review-produced',
      criteria: [
        {
          id: 'C1',
          mandatory: true,
          severity: 'critical',
          verdict: 'pass',
          reason: 'Exact verified amount',
          evidencePaths: ['facts.json'],
        },
      ],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        candidateCostUsd: null,
        judgeCostUsd: null,
        durationMs: 0,
        toolAttempts: 0,
        toolExecutions: 0,
        committedEffects: 0,
      },
      artifacts: [],
    });
  }
  test('wrong critical facts and judge errors cannot claim strict success', () => {
    const wrong = result();
    wrong.criteria[0]!.verdict = 'fail';
    assert.equal(ResultSchema.safeParse(wrong).success, false);
    const error = result();
    error.criteria[0]!.verdict = 'error';
    error.gradingStatus = 'judge-error';
    assert.equal(ResultSchema.safeParse(error).success, false);
    const exhausted = result();
    exhausted.status = 'budget-exhausted';
    assert.equal(ResultSchema.safeParse(exhausted).success, false);
    const optionalCritical = result();
    optionalCritical.criteria[0]!.mandatory = false;
    optionalCritical.strictSuccess = false;
    assert.equal(ResultSchema.safeParse(optionalCritical).success, false);
  });
  test('missing result rows remain visible and suppress a comparable headline', () => {
    const report = accountResults(manifest(), [result()]);
    assert.equal(report.rows.length, 2);
    assert.equal(report.counts.ungraded, 1);
    assert.equal(report.comparable, false);
    assert.equal(report.strictSuccessRate, null);
    const complete = accountResults(manifest(), [result(), result(1)]);
    assert.equal(complete.strictSuccessRate, 1);
    assert.throws(() => accountResults(manifest(), [result(), result()]), /duplicate/);
  });
  test('saved manifest rejects missing repeats and trace rejects fictitious commits', async () => {
    const root = await workspace();
    const file = path.join(root, 'manifest.json');
    const run = manifest();
    await writeFile(file, jsonText(run));
    assert.deepEqual(await validateArtifact(file, 'manifest'), { kind: 'manifest', valid: true });
    run.cases.pop();
    await writeFile(file, jsonText(run));
    await assert.rejects(validateArtifact(file, 'manifest'), /omits selected repeats/);
    const trace = path.join(root, 'trace.jsonl');
    await writeFile(
      trace,
      JSON.stringify({
        schemaVersion: '1.0.0',
        runId: 'example',
        taskId: TASK,
        sequence: 0,
        at: '2026-10-01T00:00:00Z',
        type: 'effect-committed',
        callId: 'call-1',
        operationId: 'operation-1',
        effect: 'email-send',
        evidencePath: 'effects.json',
      }),
    );
    await assert.rejects(validateArtifact(trace, 'trace'), /without executed tool/);
  });
});
