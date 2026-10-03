import { afterEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SuiteSchema, TaskSchema } from '#contracts/task';
import { CaseControlsSchema } from '#contracts/authoring';
import { AUTHORED_CASES } from '#fixtures/authoring/index';
import { POLICY_V11, POLICY_V12 } from '#fixtures/authoring/policy';
import { generatedFiles } from '#fixtures/generate';
import { discover } from '#tasks/discover';
import { preflight, validateTask } from '#tasks/validate';
import { visibleInput } from '#tasks/visible-input';
import { gradeArtifactControls } from '#src/grading/controls';
import { jsonText, readJson, sha256 } from '#src/io';
import { exactFact } from '#src/grading/facts';
import { unobservedCommits } from '#src/grading/trace';
import { TraceEventSchema } from '#contracts/trace';
import { ADDITIVE_MARKUP_CONTROL, NESTED_TRACE_CONTROL } from '#fixtures/authoring/grader-controls';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const specs = AUTHORED_CASES.map((make) => make());
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function workspace() {
  await mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const root = await mkdtemp(path.join(ROOT, 'tmp/authored-'));
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

describe('authored case library (#12-#15)', () => {
  test('every authored case validates with draft review, exact locators and hidden controls', async () => {
    const discovered = await discover(ROOT);
    for (const spec of specs) {
      const entry = discovered.find((item) => item.task.id === spec.id);
      assert.ok(entry, `${spec.id} is generated`);
      assert.equal(entry.task.schemaVersion, '1.2.0');
      const validated = await validateTask(ROOT, entry.task);
      assert.equal(validated.provenance.review.status, 'draft');
      assert.equal(validated.verification?.review.status, 'draft');
      assert.equal(validated.controls?.review.status, 'draft');
      // #12 asks for 6-12 necessary criteria on its document cases; other core
      // cases need at least four and narrow diagnostics/variants at least two.
      const minimum =
        ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08'].includes(spec.definitionId) &&
        spec.role === 'core'
          ? 6
          : spec.role === 'core'
            ? 4
            : 2;
      const count = validated.rubric.criteria.length;
      assert.ok(count >= minimum && count <= 12, `${spec.id}: ${count} criteria`);
      assert.ok(validated.controls!.controls.some((control) => control.kind === 'negative'));
    }
  });
  test('candidate projection never contains hidden expectations or control outputs', async () => {
    const discovered = await discover(ROOT);
    for (const spec of specs) {
      const { task } = discovered.find((item) => item.task.id === spec.id)!;
      const text = JSON.stringify(await visibleInput(ROOT, task));
      for (const hidden of ['expectedFacts', 'passIf', 'failIf', 'grading/', 'controlsHash'])
        assert.ok(!text.includes(hidden), `${spec.id}: ${hidden}`);
      for (const control of spec.controls)
        assert.ok(!text.includes(control.description), `${spec.id}: control ${control.id}`);
      assert.ok(task.inputs.some((input) => input.kind === 'policy'));
    }
  });
  test('every hidden document control produces exactly its declared verdicts', async () => {
    const discovered = await discover(ROOT);
    for (const spec of specs.filter((item) => item.profile === 'documents')) {
      const { task } = discovered.find((item) => item.task.id === spec.id)!;
      const report = await gradeArtifactControls(ROOT, task);
      assert.equal(report.valid, true, JSON.stringify(report.outcomes, null, 2));
      const critical = new Set(
        spec.criteria.filter((c) => c.severity === 'critical').map((c) => c.id),
      );
      for (const control of spec.controls) {
        const outcome = report.outcomes.find((item) => item.controlId === control.id)!;
        const criticalFailure = (control.expect?.fail ?? []).some((id) => critical.has(id));
        assert.equal(
          outcome.criticalGatesPassed,
          !criticalFailure,
          `${spec.id}/${control.id}: critical gate must follow its critical failures`,
        );
      }
    }
  });
  test('core suites hold exactly one core case per authored definition', async () => {
    const files = await generatedFiles();
    const cores = specs.filter((spec) => spec.role === 'core');
    assert.equal(new Set(cores.map((spec) => spec.definitionId)).size, cores.length);
    const coreSuites = [...files.entries()]
      .filter(([file]) => /^suites\/(development|held-out|fixed-tools-[a-z-]+)\.json$/.test(file))
      .map(([, text]) => SuiteSchema.parse(JSON.parse(text)));
    const selected = coreSuites.flatMap((suite) => suite.cases);
    for (const spec of cores) assert.equal(selected.filter((id) => id === spec.id).length, 1);
    for (const spec of specs.filter((item) => item.role !== 'core'))
      assert.ok(!selected.includes(spec.id), `${spec.id} must not enter a core denominator`);
    for (const spec of specs.filter((item) => item.variantOf))
      assert.ok(specs.some((item) => item.id === spec.variantOf && item.role === 'core'));
  });
  test('authored cases share frozen policy 1.1.0 bytes; #20 analytics use 1.2.0', async () => {
    assert.equal(
      await readFile(path.join(ROOT, 'fixtures/policies/nsw-builder-v1.1.md'), 'utf8'),
      POLICY_V11,
    );
    assert.equal(
      await readFile(path.join(ROOT, 'fixtures/policies/nsw-builder-v1.2.md'), 'utf8'),
      POLICY_V12,
    );
    // 1.2.0 only appends analytics sections; earlier rules are byte-identical.
    const rules = POLICY_V11.slice(
      POLICY_V11.indexOf('## 1. Evidence'),
      POLICY_V11.indexOf('These expectations'),
    );
    assert.ok(POLICY_V12.includes(rules));
    for (const spec of specs)
      assert.equal(
        await readFile(path.join(ROOT, `tasks/${spec.id}/policies/business.md`), 'utf8'),
        spec.policyVersion === '1.2.0' ? POLICY_V12 : POLICY_V11,
      );
    assert.deepEqual(
      specs.filter((spec) => spec.policyVersion === '1.2.0').map((spec) => spec.definitionId),
      ['D13', 'D14', 'D15', 'D16'],
    );
  });
  test('tampered controls, fuzzy locators and undeclared role fields are refused', async () => {
    const root = await workspace();
    const id = specs.find((spec) => spec.profile === 'documents')!.id;
    const taskFile = path.join(root, `tasks/${id}/task.json`);
    const task = TaskSchema.parse(await readJson(taskFile));
    const controlsFile = path.join(root, `tasks/${id}/grading/controls.json`);
    const controls = CaseControlsSchema.parse(await readJson(controlsFile));
    // A reference control may not hide an expected failure.
    controls.controls[0]!.expected[Object.keys(controls.controls[0]!.expected)[0]!] = 'fail';
    assert.throws(() => CaseControlsSchema.parse(controls), /must not expect a failure/);
    // Changed control bytes fail the frozen hash.
    await writeFile(path.join(root, `tasks/${id}/grading/controls/reference/review.md`), 'x');
    await assert.rejects(validateTask(root, task), /Control output hash mismatch/);
    // A locator that does not name exactly one normalized unit is refused.
    const rubricFile = path.join(root, `tasks/${id}/grading/rubric.json`);
    const rubric = (await readJson(rubricFile)) as {
      criteria: { evidence: { locator: string }[] }[];
    };
    rubric.criteria[0]!.evidence[0]!.locator = 'whole document';
    await writeFile(rubricFile, jsonText(rubric));
    const fuzzy = { ...task, rubricHash: sha256(jsonText(rubric)) };
    await assert.rejects(validateTask(root, fuzzy), /Unresolved evidence locator|hash mismatch/);
    // Earlier task schemas cannot carry 1.2.0 role or control fields.
    assert.equal(TaskSchema.safeParse({ ...task, schemaVersion: '1.1.0' }).success, false);
    assert.equal(
      TaskSchema.safeParse({ ...task, role: 'variant', variantOf: null }).success,
      false,
    );
  });
  test('run preflight independently requires authored controls, environment and operator review', async () => {
    const root = await workspace();
    // Synthetic completed-review metadata exists only inside this disposable test.
    const review = {
      status: 'approved',
      reviewer: 'Synthetic gate-test reviewer',
      reviewedAt: '2026-10-02T00:00:00Z',
      notes: 'Test-only gate exercise; no actual human approval.',
    };
    for (const spec of [
      specs.find((item) => item.profile === 'documents')!,
      specs.find((item) => item.profile === 'fixed-tools')!,
    ]) {
      const taskFile = path.join(root, `tasks/${spec.id}/task.json`);
      const task = TaskSchema.parse(await readJson(taskFile));
      const patchHidden = async (
        relative: string,
        hash: 'provenanceHash' | 'verificationHash' | 'controlsHash' | 'environmentHash',
        change: (value: any) => void,
      ) => {
        const file = path.join(root, `tasks/${spec.id}`, relative);
        const value = await readJson(file);
        change(value);
        const text = jsonText(value);
        await writeFile(file, text);
        task[hash] = sha256(text);
        await writeFile(taskFile, jsonText(task));
      };
      const worldFile = path.join(root, `fixtures/worlds/${task.worldId}.json`);
      const world = (await readJson(worldFile)) as Record<string, unknown>;
      world.review = review;
      await writeFile(worldFile, jsonText(world));
      const fixtureFile = path.join(root, `tasks/${spec.id}`, task.fixturePath);
      const fixture = (await readJson(fixtureFile)) as Record<string, unknown>;
      fixture.worldHash = sha256(jsonText(world));
      await writeFile(fixtureFile, jsonText(fixture));
      task.fixtureHash = sha256(jsonText(fixture));
      await patchHidden(task.provenancePath, 'provenanceHash', (value) => {
        value.review = review;
      });
      await patchHidden(task.verificationPath!, 'verificationHash', (value) => {
        value.review = review;
      });
      // Select exactly this case; other suite entries/worlds still undergo isolation.
      const suite =
        spec.profile === 'documents'
          ? 'suites/development.json'
          : 'suites/fixed-tools-development.json';
      const selection = SuiteSchema.parse(await readJson(path.join(root, suite)));
      selection.split = spec.split;
      selection.cases = [task.id];
      await writeFile(path.join(root, suite), jsonText(selection));
      assert.match((await preflight(root, suite, true)).cases[0]!.reason!, /Human control review/);
      await patchHidden(task.controlsPath!, 'controlsHash', (value) => {
        value.review = review;
      });
      if (spec.profile === 'fixed-tools') {
        assert.match(
          (await preflight(root, suite, true)).cases[0]!.reason!,
          /Human environment\/operator review/,
        );
        await patchHidden(task.environmentPath!, 'environmentHash', (value) => {
          value.review = review;
        });
        assert.match(
          (await preflight(root, suite, true)).cases[0]!.reason!,
          /Human environment\/operator review/,
        );
      } else {
        assert.equal((await preflight(root, suite, true)).cases[0]!.status, 'ready');
      }
    }
  });
});

describe('measurement-system controls (#15)', () => {
  test('a child-session write hidden from the parent trace is still exposed', () => {
    for (const control of NESTED_TRACE_CONTROL.cases) {
      const trace = control.parentTrace.map((event, sequence) =>
        TraceEventSchema.parse({
          schemaVersion: '1.1.0',
          runId: 'nested-control',
          taskId: 'safety/nested-trace',
          sequence,
          at: '2026-10-04T00:00:00Z',
          ...event,
        }),
      );
      assert.deepEqual(
        unobservedCommits(trace, control.operations, 'case-session'),
        control.expectedUnobserved,
        control.id,
      );
    }
  });
  test('a parent execution cannot hide a child commit with the same call ID or a different tool', () => {
    const events = [
      TraceEventSchema.parse({
        schemaVersion: '1.1.0',
        runId: 'collision-control',
        taskId: 'safety/nested-trace',
        sequence: 0,
        at: '2026-10-04T00:00:00Z',
        type: 'tool-executed',
        callId: 'call-a',
        tool: 'get_lead',
        outcome: 'success',
        result: {},
      }),
    ];
    const keys = ['child-session:call-a:get_lead', 'case-session:call-a:create_lead_task'];
    assert.deepEqual(
      unobservedCommits(
        events,
        keys.map((key) => ({ key, status: 'committed' })),
        'case-session',
      ),
      keys,
    );
  });
  test('the additive markup control rejects the compounded total', () => {
    const { expectedCents, wrongCompoundedContractCents } = ADDITIVE_MARKUP_CONTROL;
    assert.equal(
      expectedCents.costBaseCents +
        expectedCents.overheadCents +
        expectedCents.feeCents +
        expectedCents.gstCents,
      expectedCents.contractCents,
    );
    assert.equal(exactFact(expectedCents.contractCents, 66000000, 'cents'), true);
    assert.equal(
      exactFact(wrongCompoundedContractCents, expectedCents.contractCents, 'cents'),
      false,
    );
  });
  test('negative controls cover every consequential failure category', async () => {
    const index = (await readJson(
      path.join(ROOT, 'fixtures/grader-controls/negative-control-index.json'),
    )) as { coverage: Record<string, number>; controls: { taskId: string }[] };
    for (const mode of [
      'wrong-amount',
      'wrong-date',
      'wrong-party',
      'wrong-identifier',
      'wrong-decision',
      'invented-value',
      'missed-discrepancy',
      'fabricated-citation',
      'false-success',
      'premature-write',
      'unapproved-write',
      'duplicate-write',
      'stale-overwrite',
      'wrong-target',
      'injection-followed',
      'protected-state-changed',
    ])
      assert.ok((index.coverage[mode] ?? 0) > 0, `no negative control for ${mode}`);
    assert.equal(
      index.controls.length,
      specs.flatMap((spec) => spec.controls.filter((c) => c.kind === 'negative')).length,
    );
  });
  test('diagnostics and variants carry separate denominators and explicit profiles', async () => {
    const files = await generatedFiles();
    const suite = SuiteSchema.parse(JSON.parse(files.get('suites/safety-diagnostics.json')!));
    assert.equal(suite.profile, 'fixed-tools');
    const diagnostics = specs.filter((spec) => spec.role === 'diagnostic');
    assert.ok(diagnostics.length >= 6);
    for (const spec of diagnostics) assert.ok(suite.cases.includes(spec.id), spec.id);
    for (const spec of specs.filter(
      (item) => item.role === 'variant' && item.profile === 'documents',
    )) {
      const name = spec.split === 'development' ? 'development-variants' : 'held-out-variants';
      assert.ok(
        SuiteSchema.parse(JSON.parse(files.get(`suites/${name}.json`)!)).cases.includes(spec.id),
      );
    }
  });
});
