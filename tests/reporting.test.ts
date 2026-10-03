import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CASE, mockFactory, runtime, spec, workspace } from './helpers/experiments.js';
import { planExperiment } from '#runs/manifest';
import { ExperimentLedger, experimentDirectory } from '#runs/artifacts';
import { documentTrialExecutor, runExperiment } from '#runs/sweep';
import { buildExperimentReport, type ExperimentReport, type TrialRow } from '#reporting/report';
import { compare, compatibility } from '#reporting/compare';
import { comparisonHtml, csvCell, reportCsv, reportHtml, reportJson } from '#reporting/export';
import { escape, safeHref } from '#reporting/templates/html';
import { main } from '#src/cli';

const HOSTILE = `<script>alert("x")</script><img src=x onerror=alert(1)> [x](javascript:alert(1))`;
async function offlineExperiment(options: { budget?: number } = {}) {
  const root = await workspace();
  const plan = await planExperiment(
    root,
    spec(
      options.budget
        ? {
            concurrency: 2,
            budget: {
              ...spec().budget,
              perTrialCandidateUsd: options.budget,
              totalCandidateUsd: options.budget,
            },
          }
        : {},
    ),
    { mode: 'offline-control', runtime },
  );
  const directory = experimentDirectory(root, plan.experimentId);
  const ledger = await ExperimentLedger.create(directory, plan);
  // Wrong weighted pipeline and a hostile review body from the "candidate".
  await runExperiment(root, ledger, {
    allowPaid: false,
    executor: documentTrialExecutor(
      mockFactory({
        facts: () => ({ weightedPipelineCents: 121210500, unknownValueCount: 2 }),
        review: () => `${HOSTILE} Key sk-live_ABCDEFGHIJKLMNOP1234`,
      }),
    ),
  });
  return { root, plan, directory };
}

describe('reports, comparisons and exports (#17)', () => {
  test('a reviewer can see which critical fact failed with required versus actual evidence', async () => {
    const { directory } = await offlineExperiment();
    const report = await buildExperimentReport(directory, { linkBase: '..' });
    assert.equal(report.label, 'Documents');
    assert.equal(report.benchmarkEligible, false);
    assert.ok(report.warnings.some((line) => /Offline-control/.test(line)));
    assert.equal(report.trials.length, 6);
    const row = report.trials[0]!;
    const c1 = row.criteria.find((item) => item.id === 'C1')!;
    assert.equal(c1.severity, 'critical');
    assert.equal(c1.verdict, 'fail');
    assert.equal(c1.expected, 138682500);
    assert.equal(c1.actual, 121210500);
    assert.ok(c1.evidence.length > 0, 'original source locators are linked');
    assert.ok(
      row.explanations.some((line) =>
        /CRITICAL C1 .*required 138682500, actual 121210500/.test(line),
      ),
    );
    // Missing fields are explicit, never treated as a pass.
    const c3 = row.criteria.find((item) => item.id === 'C3')!;
    assert.equal(c3.verdict, 'fail');
    assert.deepEqual(Object.keys(c3.actual as object), ['missing']);
    assert.ok(row.tools.attempted.length >= 3 && row.tools.executed.length >= 3);
    assert.ok(row.links.outputs.some((href) => href.endsWith('/outputs/review.md')));
    // Semantic criteria are ungraded, so there is no complete comparable headline.
    for (const item of report.configurations) {
      assert.equal(item.complete, false);
      assert.equal(item.headline.strictSuccessRate, null);
      assert.match(item.headline.reason, /not fully graded/);
      assert.equal(item.counts.planned, 3);
    }
  });

  test('interrupted or budget-stopped coverage is shown as missing with no headline', async () => {
    const { directory } = await offlineExperiment({ budget: 0.3 });
    const report = await buildExperimentReport(directory);
    const missing = report.configurations.reduce((total, item) => total + item.counts.missing, 0);
    assert.equal(missing, 5);
    assert.ok(report.configurations.every((item) => item.headline.strictSuccessRate === null));
    assert.ok(report.configurations.some((item) => /missing/.test(item.headline.reason)));
    assert.equal(report.caseCounts.selected, 8);
    assert.equal(report.caseCounts.planned, 1);
    assert.equal(report.exclusions.length, 7, 'excluded suite cases stay listed with reasons');
  });

  test('exports are offline, escaped and secret-free; CLI writes new report files', async () => {
    const { root, plan, directory } = await offlineExperiment();
    const report = await buildExperimentReport(directory, { linkBase: '..' });
    const html = reportHtml(report);
    assert.ok(!/<script/i.test(html), 'no raw script survives');
    assert.ok(!/<img/i.test(html));
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.ok(!html.includes('sk-live_ABCDEFGHIJKLMNOP1234'));
    for (const href of html.matchAll(/href="([^"]+)"/g))
      assert.ok(!/^[a-z]+:/i.test(href[1]!), `unsafe link ${href[1]}`);
    const json = reportJson(report);
    assert.ok(!json.includes('sk-live_ABCDEFGHIJKLMNOP1234'));
    JSON.parse(json);
    const csv = reportCsv(report);
    assert.equal(csv.split('\r\n').filter(Boolean).length, 7);
    assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    assert.equal(csvCell('-1+2'), "'-1+2");
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(escape('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
    assert.equal(safeHref('javascript:alert(1)'), null);
    assert.equal(safeHref('../trials/a/../../etc'), null);
    assert.equal(safeHref('https://example.com'), null);
    assert.equal(safeHref('../trials/trial-1/trace.jsonl'), null, 'parent segments are refused');
    assert.equal(safeHref('trials/trial-1/trace.jsonl'), 'trials/trial-1/trace.jsonl');
    const logs: string[] = [];
    const original = console.log;
    console.log = (value: unknown) => logs.push(String(value));
    try {
      for (const format of ['html', 'csv', 'json'])
        assert.equal(
          await main(['report', plan.experimentId, '--root', root, '--format', format]),
          0,
        );
      await assert.rejects(
        main([
          'compare',
          `${plan.experimentId}:config-a`,
          `${plan.experimentId}:config-b`,
          '--root',
          root,
        ]),
        /INCOMPATIBLE_COMPARISON/,
      );
      assert.equal(
        await main([
          'compare',
          `${plan.experimentId}:config-a`,
          `${plan.experimentId}:config-b`,
          '--root',
          root,
          '--exploratory',
        ]),
        0,
      );
    } finally {
      console.log = original;
    }
    const files = await readdir(path.join(directory, 'reports'));
    assert.equal(files.filter((file) => file.startsWith('report-')).length, 3);
    const exploratory = files.find((file) => file.startsWith('compare-exploratory'))!;
    const text = await readFile(path.join(directory, 'reports', exploratory), 'utf8');
    assert.match(text, /EXPLORATORY/);
    assert.match(text, /No ranking is produced/);
  });

  test('formal comparisons require matching hashes, complete coverage and the same profile', () => {
    const report = syntheticReport('documents');
    const other = syntheticReport('documents');
    assert.deepEqual(compatibility(report, other), []);
    const formal = compare(
      { report, configurationId: 'a' },
      { report: other, configurationId: 'b' },
      { iterations: 500 },
    );
    assert.equal(formal.status, 'formal');
    assert.equal(formal.pairedCases, 4);
    // B succeeds on every trial and A on none: a clear positive paired difference.
    assert.equal(formal.meanDifference, 1);
    assert.equal(formal.ranking, 'b');
    assert.equal(formal.wins, 4);
    // Deterministic seeded resampling.
    assert.deepEqual(
      compare(
        { report, configurationId: 'a' },
        { report: other, configurationId: 'b' },
        { iterations: 500 },
      ).interval95,
      formal.interval95,
    );
    // Different profile, suite hash or case hash: refused unless exploratory.
    const eve = syntheticReport('royal-eve');
    assert.throws(
      () => compare({ report, configurationId: 'a' }, { report: eve, configurationId: 'b' }),
      /INCOMPATIBLE_COMPARISON: .*profile kind/,
    );
    const changed = syntheticReport('documents');
    changed.identity.cases[0]!.hashes!.rubric = 'f'.repeat(64);
    assert.throws(
      () => compare({ report, configurationId: 'a' }, { report: changed, configurationId: 'b' }),
      /case .* \(task\/fixture\/rubric/,
    );
    const exploratory = compare(
      { report, configurationId: 'a' },
      { report: eve, configurationId: 'b' },
      { exploratory: true, iterations: 100 },
    );
    assert.equal(exploratory.status, 'exploratory');
    assert.equal(exploratory.ranking, null);
    assert.match(comparisonHtml(exploratory), /not a benchmark ranking/);
    // Incomplete coverage cannot be formally compared.
    const incomplete = syntheticReport('documents');
    incomplete.configurations[1]!.complete = false;
    assert.throws(
      () => compare({ report, configurationId: 'a' }, { report: incomplete, configurationId: 'b' }),
      /incomplete coverage/,
    );
  });
});

// A complete benchmark-shaped report for comparison statistics only.
function syntheticReport(kind: ExperimentReport['kind']): ExperimentReport {
  const cases = ['analytics/a/cedar', 'analytics/b/cedar', 'offers/c/cedar', 'offers/d/cedar'];
  const hashes = {
    task: 'a'.repeat(64),
    fixture: 'b'.repeat(64),
    rubric: 'c'.repeat(64),
    provenance: 'd'.repeat(64),
    verification: 'e'.repeat(64),
    policy: '1'.repeat(64),
    sources: '2'.repeat(64),
    controls: null,
    environment: null,
  };
  const trials: TrialRow[] = [];
  for (const configurationId of ['a', 'b'])
    for (const taskId of cases)
      for (let repeat = 0; repeat < 3; repeat++)
        trials.push({
          trialId: `trial-${configurationId}-${trials.length}`,
          rerunOf: null,
          taskId,
          definitionId: 'D01',
          role: 'core',
          family: taskId.split('/')[0]!,
          configurationId,
          repeat,
          block: repeat,
          orderInBlock: 0,
          status: 'completed',
          classification: 'completed',
          coverage: 'graded-candidate',
          reason: null,
          gradingStatus: 'graded',
          strictSuccess: configurationId === 'b',
          criticalGatesPassed: configurationId === 'b',
          criteria: [],
          tools: { attempted: [], executed: [], approvals: [], effects: [] },
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            candidateCostUsd: 0,
            judgeCostUsd: 0,
            durationMs: 1,
          },
          judging: null,
          links: { bundle: '.', grade: null, trace: null, outputs: [] },
          explanations: [],
        });
  const summary = (configurationId: string) => ({
    configurationId,
    provider: 'direct',
    model: `model-${configurationId}`,
    counts: {
      planned: 12,
      finished: 12,
      completed: 12,
      valid: 12,
      failed: 0,
      graded: 12,
      ungraded: 0,
      invalid: 0,
      missing: 0,
      passed: 0,
    },
    complete: true,
    headline: {
      strictSuccessRate: configurationId === 'b' ? 1 : 0,
      denominator: 12,
      reason: 'complete',
    },
    criticalGatePassRate: null,
    macroFamilyScore: null,
    familyScores: {},
    failureCategories: {},
    criterionDiagnostics: [],
    withinCase: [],
    latencyMs: { count: 0, mean: null, p50: null, p90: null, max: null },
    tokens: { input: 0, output: 0 },
    spend: { candidateUsd: 0, judgeUsd: 0, unknownCostTrials: 0 },
  });
  return {
    schemaVersion: '1.0.0',
    kind,
    label: kind,
    experimentId: `exp-${kind}`,
    mode: 'benchmark',
    benchmarkEligible: true,
    identity: {
      planHash: '0'.repeat(64),
      suite: {
        id: 'development',
        version: '2.1.0',
        split: 'development',
        profile: kind,
        hash: '3'.repeat(64),
      },
      profile: {
        id: kind,
        version: '1.0.0',
        hash: '4'.repeat(64),
        systemPromptHash: '5'.repeat(64),
        toolSchemaHash: '6'.repeat(64),
        parserProfile: 'normalized-text',
      },
      runtime: {
        runnerRevision: null,
        runnerDirty: false,
        lockfileHash: '7'.repeat(64),
        nodeVersion: 'v24',
        guriRevision: null,
      },
      judge: null,
      seed: 's',
      repeats: 3,
      cases: cases.map((taskId) => ({ taskId, hashes: { ...hashes } })),
      configurations: [],
    },
    caseCounts: { selected: 4, compatible: 4, excluded: 0, planned: 4, notReady: 0 },
    exclusions: [],
    configurations: [summary('a'), summary('b')],
    trials,
    warnings: [],
  };
}
