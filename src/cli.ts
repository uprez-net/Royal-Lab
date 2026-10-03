import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { discover } from '#tasks/discover';
import { preflight, validateArtifact, validateTask } from '#tasks/validate';
import { visibleInput } from '#tasks/visible-input';
import { loadConfig, redact } from '#src/config';
import { generate } from '#fixtures/generate';
import { lint } from '#fixtures/lint';
import { exportSchemas } from '#contracts/export';
import { jsonText, readJson, walk } from '#src/io';

const HELP = `Royal-Lab 0.1 • NSW residential builder benchmark

Usage: pnpm lab <command> [arguments] [options]

  tui                            Interactive benchmark workbench
  list                           List authored cases and their review status
  describe <family/case>          Describe an authored case
  describe <family/case> --visible Inspect only the candidate-visible projection
  validate [--suite <path>]       Offline suite integrity (every suite by default)
  validate --for-run              Strict review/tool/execution readiness preflight
  validate --artifact <file> --kind result|trace|manifest
  fixtures generate [--check]     Create deterministic draft specimens / check drift
  fixtures lint                  Check privacy patterns and world references
  controls [<family/case>]        Grade hidden document reference/negative controls offline
  schemas export                 Export portable JSON Schemas
  config show [--config <file>]   Display explicit effective config with secrets redacted
  bridge prepare|check           Build or verify the pinned private canonical bridge
  run <task> --suite <path>       One reviewed document trial (--allow-paid required)
  plan --experiment <file>       Dry run: full suite x configuration x repeat matrix and bounded spend
  sweep --experiment <file> --allow-paid
                                Freeze the plan, then run every trial (reviewed cases only)
  resume <experiment-id> --allow-paid
                                Resume unstarted trials; interrupted ones stay recorded
  grade --experiment <experiment-id>
                                Regrade every sealed trial bundle as new grade records
  grade <run-id>                 Regrade saved artifacts offline (--replay-judge <receipt>)
  grade <run-id> --judge-profile <file> --judge-credentials <file> --suite <path> --allow-paid
                                Opt-in scoped semantic judging of saved evidence
  eve pins --eve-config <file> --checkout <dir> --commit <sha>
                                Derive deployed-agent pins from a product checkout's committed tree
  eve preflight --eve-config <file>
                                Offline Royal Eve target/pin/credential/case checks (no request)
  eve run <case-id> --eve-config <file> --allow-paid
                                One live staging case (product model spend); saves record + traces
  eve grade <eve-run-id> --eve-config <file> [--verify-output <file> --produced-at <iso> --exit-code <n>]
                                Grade a saved Eve run; durable evidence comes from the fixture maintainer
  report <experiment-id> [--format json|csv|html]
                                Offline report: coverage, criteria, tools, spend; writes under reports/
  compare <exp-a>:<config> <exp-b>:<config> [--exploratory] [--format json|html]
                                Hash-compatible paired comparison (refused if incompatible)

Options: --root <directory> --json --help
No API credentials are needed for authoring. See docs/configuration.md.
Authored cases and specimens are draft and unreviewed; no model scores exist.
`;
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      root: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      suite: { type: 'string' },
      config: { type: 'string' },
      visible: { type: 'boolean' },
      'for-run': { type: 'boolean' },
      artifact: { type: 'string' },
      kind: { type: 'string' },
      check: { type: 'boolean' },
      'allow-paid': { type: 'boolean' },
      verification: { type: 'string' },
      'judge-profile': { type: 'string' },
      'judge-credentials': { type: 'string' },
      'replay-judge': { type: 'string' },
      calibration: { type: 'string' },
      experiment: { type: 'string' },
      'lock-file': { type: 'string' },
      format: { type: 'string' },
      'eve-config': { type: 'string' },
      'verify-output': { type: 'string' },
      'produced-at': { type: 'string' },
      'exit-code': { type: 'string' },
      checkout: { type: 'string' },
      commit: { type: 'string' },
      exploratory: { type: 'boolean' },
    },
  });
  const [command, ...arguments_] = parsed.positionals;
  const options = parsed.values;
  const root = path.resolve(options.root ?? fileURLToPath(new URL('../', import.meta.url)));
  if (options.help || command === 'help' || (!command && !process.stdin.isTTY)) {
    console.log(HELP);
    return 0;
  }
  if (!command || command === 'tui') {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        'TUI requires an interactive terminal; use list/validate --json for automation.',
      );
    const { launchTui } = await import('#tui');
    await launchTui(root);
    return 0;
  }
  const required = (count: number) => {
    if (arguments_.length !== count)
      throw new Error(`${command} requires ${count} argument(s); see --help.`);
  };
  const output = (value: unknown) =>
    console.log(
      typeof value === 'string' && !options.json ? value : JSON.stringify(redact(value), null, 2),
    );
  if (command === 'list') {
    required(0);
    const tasks = await discover(root);
    const rows = await Promise.all(
      tasks.map(async ({ task }) => {
        const { provenance } = await validateTask(root, task);
        return {
          id: task.id,
          definitionId: task.definitionId,
          title: task.title,
          profiles: task.profiles,
          world: task.worldId,
          review: provenance.review.status,
        };
      }),
    );
    output(
      options.json
        ? rows
        : rows
            .map((r) => `${r.definitionId}  ${r.review.padEnd(8)} ${r.id}\n     ${r.title}`)
            .join('\n'),
    );
    return 0;
  }
  if (command === 'describe') {
    required(1);
    const entry = (await discover(root)).find((x) => x.task.id === arguments_[0]);
    if (!entry) throw new Error(`Unknown task: ${arguments_[0]}`);
    if (options.visible)
      output(await visibleInput(root, entry.task, (await loadConfig(options.config)).binaryParser));
    else {
      const { provenance } = await validateTask(root, entry.task);
      output({
        id: entry.task.id,
        title: entry.task.title,
        instruction: entry.task.instruction,
        profiles: entry.task.profiles,
        inputs: entry.task.inputs,
        deliverables: entry.task.deliverables,
        clock: entry.task.clock,
        review: provenance.review,
        executionReady: false,
      });
    }
    return 0;
  }
  if (command === 'validate') {
    required(0);
    if (options.artifact) {
      if (!['result', 'trace', 'manifest'].includes(options.kind ?? ''))
        throw new Error('--artifact requires --kind result|trace|manifest');
      output(
        await validateArtifact(
          path.resolve(root, options.artifact),
          options.kind as 'result' | 'trace' | 'manifest',
        ),
      );
      return 0;
    }
    const files = options.suite
      ? [options.suite]
      : (await walk(path.join(root, 'suites')))
          .filter((file) => file.endsWith('.json'))
          .map((file) => `suites/${file}`);
    const reports = [];
    for (const file of files)
      reports.push(await preflight(root, file, options['for-run'] ?? false));
    output(
      reports.map(({ valid, suite, cases, errors }) => ({
        valid,
        suite: suite.id,
        mode: options['for-run'] ? 'execution-readiness' : 'offline-integrity',
        cases,
        errors,
      })),
    );
    return reports.every((r) => r.valid) ? 0 : 1;
  }
  if (command === 'fixtures') {
    required(1);
    if (arguments_[0] === 'generate') {
      const result = await generate(root, options.check ?? false);
      output(result);
      return result.valid ? 0 : 1;
    }
    if (arguments_[0] === 'lint') {
      const result = await lint(root);
      output(result);
      return result.valid ? 0 : 1;
    }
    throw new Error('fixtures requires generate or lint');
  }
  if (command === 'controls') {
    if (arguments_.length > 1) throw new Error('controls accepts at most one case ID');
    const { gradeArtifactControls } = await import('#src/grading/controls');
    const selected = (await discover(root)).filter(
      ({ task }) =>
        task.schemaVersion === '1.2.0' &&
        task.profiles.includes('documents') &&
        (!arguments_[0] || task.id === arguments_[0]),
    );
    if (arguments_[0] && selected.length === 0)
      throw new Error(`No authored document case: ${arguments_[0]}`);
    const reports: Awaited<ReturnType<typeof gradeArtifactControls>>[] = [];
    for (const { task } of selected) reports.push(await gradeArtifactControls(root, task));
    const describe = (report: (typeof reports)[number]) => [
      `${report.valid ? 'ok  ' : 'FAIL'} ${report.taskId}`,
      ...report.outcomes.flatMap((outcome) => [
        `     ${outcome.matches ? 'ok  ' : 'FAIL'} ${outcome.kind.padEnd(9)} ${outcome.controlId}`,
        ...outcome.mismatches.map(
          (m) =>
            `          ${m.criterionId}: expected ${m.expected}, got ${m.actual} (${m.reason})`,
        ),
      ]),
    ];
    output(
      options.json
        ? reports
        : [
            ...reports.flatMap(describe),
            'Offline measurement controls only: no candidate or judge call, score or human review.',
          ].join('\n'),
    );
    return reports.every((report) => report.valid) ? 0 : 1;
  }
  if (command === 'schemas') {
    required(1);
    if (arguments_[0] !== 'export') throw new Error('schemas requires export');
    output(await exportSchemas(root));
    return 0;
  }
  if (command === 'config') {
    required(1);
    if (arguments_[0] !== 'show') throw new Error('config requires show');
    output(await loadConfig(options.config));
    return 0;
  }
  if (command === 'bridge') {
    required(1);
    const config = await loadConfig(options.config);
    if (!config.bridge)
      throw new Error(
        'BRIDGE_CONFIG_MISSING: explicit checkout and disposable local fixtureDatabaseUrl required',
      );
    const checkout = path.resolve(root, config.bridge.checkout);
    if (arguments_[0] === 'prepare') {
      const { prepareGuri } = await import('#src/environments/guri/build');
      output(await prepareGuri(root, checkout));
      return 0;
    }
    if (arguments_[0] === 'check') {
      const { GuriBridge } = await import('#src/environments/guri/bridge');
      await new GuriBridge(
        checkout,
        path.join(root, '.cache/guri'),
        config.bridge.fixtureDatabaseUrl,
        '2026-10-04T00:00:00Z',
      ).verify();
      output({
        status: 'verified',
        scope:
          'pinned minimum canonical bridge; integrity verification is not a model run, score or release readiness',
        capabilities: (await import('#src/environments/guri/capabilities')).GURI_CAPABILITIES,
      });
      return 0;
    }
    throw new Error('bridge requires prepare or check');
  }
  if (command === 'run') {
    required(1);
    if (!options.suite || !options.verification)
      throw new Error('run requires --suite and --verification <case-local grading/file.json>');
    const { executeDocumentTrial } = await import('#runs/execute');
    const result = await executeDocumentTrial(
      root,
      arguments_[0]!,
      options.suite,
      await loadConfig(options.config),
      options.verification,
      options['allow-paid'] ?? false,
    );
    output(result);
    return result.status === 'completed' ? 0 : 1;
  }
  if (command === 'plan' || command === 'sweep') {
    required(0);
    if (!options.experiment) throw new Error(`${command} requires --experiment <file>`);
    const { loadExperimentSpec, planExperiment, describePlan } = await import('#runs/manifest');
    const spec = await loadExperimentSpec(root, options.experiment);
    if (command === 'plan') {
      const plan = await planExperiment(root, spec);
      output(options.json ? plan : describePlan(plan));
      return plan.preflight.valid ? 0 : 1;
    }
    if (!options['allow-paid'])
      throw new Error(
        'PAID_EXECUTION_DISABLED: use --allow-paid only for intentional candidate requests',
      );
    const { ExperimentLedger, experimentDirectory } = await import('#runs/artifacts');
    const { runExperiment, documentTrialExecutor, paidAdapterFactory } =
      await import('#runs/sweep');
    const plan = await planExperiment(root, spec);
    // The frozen plan and ledger are kept even when preflight blocks execution.
    const ledger = await ExperimentLedger.create(
      experimentDirectory(root, plan.experimentId),
      plan,
    );
    if (plan.suite.profile !== 'documents')
      throw new Error('SWEEP_PROFILE_UNSUPPORTED: CLI sweeps execute the documents profile');
    try {
      const outcome = await runExperiment(root, ledger, {
        allowPaid: true,
        executor: documentTrialExecutor(
          paidAdapterFactory,
          (await loadConfig(options.config)).binaryParser,
        ),
        ...(options['lock-file'] ? { externalLockFile: options['lock-file'] } : {}),
      });
      output(summarizeOutcome(outcome));
      return outcome.stopped || outcome.controllerErrors.length ? 1 : 0;
    } catch (error) {
      output({
        status: 'blocked-input',
        experimentId: plan.experimentId,
        reason: String(redact(error instanceof Error ? error.message : error)),
      });
      return 1;
    }
  }
  if (command === 'resume') {
    required(1);
    if (!options['allow-paid'])
      throw new Error(
        'PAID_EXECUTION_DISABLED: use --allow-paid only for intentional candidate requests',
      );
    const { ExperimentLedger, experimentDirectory } = await import('#runs/artifacts');
    const { runExperiment, documentTrialExecutor, paidAdapterFactory } =
      await import('#runs/sweep');
    const { Id } = await import('#contracts/common');
    const ledger = await ExperimentLedger.open(experimentDirectory(root, Id.parse(arguments_[0])));
    const outcome = await runExperiment(root, ledger, {
      allowPaid: true,
      executor: documentTrialExecutor(
        paidAdapterFactory,
        (await loadConfig(options.config)).binaryParser,
      ),
      ...(options['lock-file'] ? { externalLockFile: options['lock-file'] } : {}),
    });
    output(summarizeOutcome(outcome));
    return outcome.stopped || outcome.controllerErrors.length ? 1 : 0;
  }
  if (command === 'grade' && options.experiment) {
    required(0);
    const { ExperimentLedger, experimentDirectory } = await import('#runs/artifacts');
    const { regradeExperiment } = await import('#runs/sweep');
    const { Id } = await import('#contracts/common');
    const ledger = await ExperimentLedger.open(
      experimentDirectory(root, Id.parse(options.experiment)),
    );
    const graded = await regradeExperiment(ledger);
    output({
      experimentId: ledger.plan.experimentId,
      regraded: graded.length,
      records: graded.map((event) => event.gradeFile),
    });
    return 0;
  }
  if (command === 'grade') {
    required(1);
    const { securePath } = await import('#src/io');
    const { regradeSaved } = await import('#runs/regrade');
    if (
      options['replay-judge'] &&
      (options['judge-profile'] || options['judge-credentials'] || options['allow-paid'])
    )
      throw new Error('JUDGE_REPLAY_EXECUTION_CONFLICT');
    if (options['judge-profile']) {
      if (!options['allow-paid']) throw new Error('PAID_JUDGING_DISABLED');
      if (!options['judge-credentials'] || !options.suite)
        throw new Error('JUDGE_EXPLICIT_CREDENTIALS_AND_SUITE_REQUIRED');
      const { JudgeProfileSchema } = await import('#contracts/judge');
      const { z } = await import('zod');
      const { Id } = await import('#contracts/common');
      const profile = JudgeProfileSchema.parse(
        await readJson(await securePath(root, options['judge-profile'])),
      );
      const credentials = z
        .record(Id, z.string().min(1))
        .parse(await readJson(await securePath(root, options['judge-credentials'])));
      output(
        await regradeSaved(await securePath(root, `results/${arguments_[0]}`), {
          semantic: {
            profile,
            credentials,
            allowPaid: true,
            ...(options.calibration
              ? { calibration: { directory: root, file: options.calibration } }
              : {}),
          },
          readiness: { root, suite: options.suite },
        }),
      );
    } else {
      if (options['allow-paid'] || options['judge-credentials'] || options.calibration)
        throw new Error('JUDGE_PROFILE_REQUIRED');
      output(
        await regradeSaved(
          await securePath(root, `results/${arguments_[0]}`),
          options['replay-judge'] ? { replayReceipt: options['replay-judge'] } : {},
        ),
      );
    }
    return 0;
  }
  if (command === 'eve') {
    if (!options['eve-config']) throw new Error('eve requires --eve-config <file>');
    const { evePreflight } = await import('#src/environments/eve/preflight');
    const { ProfileSchema } = await import('#contracts/profile');
    const { z } = await import('zod');
    const { mkdir, writeFile, readFile: read } = await import('node:fs/promises');
    const { securePath } = await import('#src/io');
    // Explicit evaluator config: target, optional staging host, the NAME of the
    // bootstrap secret variable, an optional pinned-deployment overlay, and cases.
    const eveConfig = z
      .looseObject({
        target: z.string(),
        stagingHost: z.string().nullable().default(null),
        secretEnv: z.string(),
        cases: z.array(z.string()).default([]),
        deploymentPins: z.record(z.string(), z.json()).default({}),
      })
      .parse(await readJson(path.resolve(root, options['eve-config'])));
    const base = ProfileSchema.parse(
      await readJson(await securePath(root, 'profiles/royal-eve.json')),
    );
    const profile = ProfileSchema.parse({
      ...base,
      deployment: { ...base.deployment, ...eveConfig.deploymentPins },
    });
    const sub = arguments_[0];
    const selected = sub === 'run' ? [arguments_[1] ?? ''] : eveConfig.cases;
    const { deploymentPins: _pins, ...runConfig } = eveConfig;
    const check = evePreflight(profile, { ...runConfig, cases: selected }, process.env);
    if (sub === 'pins') {
      required(1);
      if (!options.checkout || !options.commit)
        throw new Error('eve pins requires --checkout <product checkout> and --commit <sha>');
      const { deriveEvePins } = await import('#src/environments/eve/pins');
      const pins = await deriveEvePins(
        path.resolve(root, options.checkout),
        options.commit,
        profile.deployment!,
      );
      output(pins);
      return pins.findings.length ? 1 : 0;
    }
    if (sub === 'preflight') {
      required(1);
      output(check);
      return check.valid ? 0 : 1;
    }
    const resultsRoot = path.join(root, 'results', 'eve');
    if (sub === 'run') {
      required(2);
      if (!options['allow-paid'])
        throw new Error('PAID_EXECUTION_DISABLED: a live Eve case spends the product model budget');
      if (!check.valid || check.selected[0]?.status !== 'ready')
        throw new Error(
          `EVE_PREFLIGHT_FAILED: ${[...check.errors, ...check.selected.map((s) => s.reason ?? '')].filter(Boolean).join('; ')}`,
        );
      const { RoyalEveClient, runEveCase } = await import('#src/harness/adapters/royal-eve');
      const item = check.deployment!.supportedCases.find((c) => c.id === arguments_[1])!;
      const client = new RoyalEveClient({
        target: eveConfig.target,
        stagingHost: eveConfig.stagingHost,
        secret: () => process.env[eveConfig.secretEnv] ?? '',
        deployment: check.deployment!,
      });
      try {
        const run = await runEveCase(client, item, {
          profileVersion: profile.version,
          labels: { [item.fixtureLabelEnv]: process.env[item.fixtureLabelEnv] },
          turnTimeoutMs: check.deployment!.budgets.maxTurnMs,
        });
        const directory = path.join(resultsRoot, run.record.runId);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, 'record.json'), jsonText(run.record), { flag: 'wx' });
        await writeFile(
          path.join(directory, 'observation.json'),
          jsonText(redact(run.observation)),
          { flag: 'wx' },
        );
        await writeFile(path.join(directory, 'deployment.json'), jsonText(check.deployment), {
          flag: 'wx',
        });
        output({
          runId: run.record.runId,
          outcome: run.record.outcome,
          reason: run.record.reason,
          label: 'Royal Eve (composed product agent)',
          next:
            run.record.outcome !== 'completed'
              ? 'Not executed: fix the reported target/credential/fixture issue; nothing ran on staging.'
              : item.kind === 'approved-write'
                ? 'Ask the fixture maintainer for eve:eval:fixtures verify output, then run eve grade.'
                : 'Run eve grade to grade the saved observation.',
        });
        return run.record.outcome === 'completed' ? 0 : 1;
      } finally {
        await client.close();
      }
    }
    if (sub === 'grade') {
      required(2);
      const { Id } = await import('#contracts/common');
      const { EveRunRecordSchema, EveDeploymentSchema } = await import('#contracts/eve');
      const { gradeEveRun } = await import('#src/environments/eve/grade');
      const { importFixtureVerify } = await import('#src/environments/eve/verifier-import');
      const directory = path.join(resultsRoot, Id.parse(arguments_[1]));
      const record = EveRunRecordSchema.parse(await readJson(path.join(directory, 'record.json')));
      const deployment = EveDeploymentSchema.parse(
        await readJson(path.join(directory, 'deployment.json')),
      );
      const observation = (await readJson(path.join(directory, 'observation.json'))) as Parameters<
        typeof gradeEveRun
      >[1]['observation'];
      const item = deployment.supportedCases.find((c) => c.id === record.caseId)!;
      let evidence = null;
      if (options['verify-output']) {
        if (!options['produced-at'] || options['exit-code'] === undefined)
          throw new Error('--verify-output requires --produced-at and --exit-code');
        evidence = importFixtureVerify(
          await read(path.resolve(root, options['verify-output']), 'utf8'),
          {
            productRevision: profile.guriRevision!,
            producedAt: options['produced-at'],
            databaseLabel: deployment.databaseLabel,
            fixtureVersion: deployment.fixtureVersion,
            exitCode: Number(options['exit-code']),
          },
        );
        await writeFile(
          path.join(directory, `durable-evidence-${evidence.rawHash.slice(0, 12)}.json`),
          jsonText(evidence),
          { flag: 'wx' },
        );
      }
      const grade = gradeEveRun(item, { record, observation }, evidence, deployment.neverApprove);
      const file = `eve-grade-${new Date()
        .toISOString()
        .replace(/[^0-9]/g, '')
        .slice(0, 14)}.json`;
      await writeFile(path.join(directory, file), jsonText(grade), { flag: 'wx' });
      output({ file, ...grade });
      return 0;
    }
    throw new Error('eve requires preflight, run or grade');
  }
  if (command === 'report' || command === 'compare') {
    const { experimentDirectory } = await import('#runs/artifacts');
    const { buildExperimentReport } = await import('#reporting/report');
    const exporter = await import('#reporting/export');
    const { Id } = await import('#contracts/common');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const format = options.format ?? (options.json ? 'json' : 'html');
    if (!['json', 'csv', 'html'].includes(format) || (command === 'compare' && format === 'csv'))
      throw new Error('--format must be json, csv or html (compare: json or html)');
    const stamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);
    // Reports are new files beside the sealed evidence; nothing is overwritten.
    const save = async (directory: string, name: string, text: string) => {
      const reports = path.join(directory, 'reports');
      await mkdir(reports, { recursive: true });
      const file = path.join(reports, `${name}-${stamp}.${format}`);
      await writeFile(file, text, { flag: 'wx' });
      return file;
    };
    if (command === 'report') {
      required(1);
      const directory = experimentDirectory(root, Id.parse(arguments_[0]));
      const report = await buildExperimentReport(directory, { linkBase: '..' });
      const text =
        format === 'json'
          ? exporter.reportJson(report)
          : format === 'csv'
            ? exporter.reportCsv(report)
            : exporter.reportHtml(report);
      const file = await save(directory, 'report', text);
      output({
        file,
        label: report.label,
        configurations: report.configurations.map((item) => ({
          configurationId: item.configurationId,
          strictSuccessRate: item.headline.strictSuccessRate,
          reason: item.headline.reason,
        })),
      });
      return 0;
    }
    required(2);
    const { compare } = await import('#reporting/compare');
    const arm = async (value: string) => {
      const [experimentId, configurationId] = value.split(':');
      if (!experimentId || !configurationId)
        throw new Error('compare arms are <experiment-id>:<configuration-id>');
      const directory = experimentDirectory(root, Id.parse(experimentId));
      return {
        directory,
        report: await buildExperimentReport(directory, { linkBase: '..' }),
        configurationId,
      };
    };
    const a = await arm(arguments_[0]!);
    const b =
      arguments_[1]!.split(':')[0] === arguments_[0]!.split(':')[0]
        ? { ...(await arm(arguments_[1]!)), report: a.report }
        : await arm(arguments_[1]!);
    const comparison = compare(a, b, { exploratory: options.exploratory ?? false });
    const text = format === 'json' ? jsonText(comparison) : exporter.comparisonHtml(comparison);
    const file = await save(a.directory, `compare-${comparison.status}`, text);
    output({
      file,
      status: comparison.status,
      ranking: comparison.ranking,
      mismatches: comparison.mismatches,
    });
    return 0;
  }
  throw new Error(`Unknown command: ${command}; see --help.`);
}
function summarizeOutcome(
  outcome: Awaited<ReturnType<typeof import('#runs/sweep').runExperiment>>,
) {
  const counts: Record<string, number> = {};
  for (const state of outcome.states) {
    const key = state.status ?? state.state;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return {
    experimentId: outcome.experimentId,
    stopped: outcome.stopped,
    interrupted: outcome.interrupted,
    trials: outcome.states.length,
    counts,
    gradingErrors: outcome.gradingErrors,
    controllerErrors: outcome.controllerErrors,
    note: 'Completion is not correctness; see the report for graded coverage.',
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(
        `Royal-Lab: ${String(redact(error instanceof Error ? error.message : String(error)))}`,
      );
      process.exitCode = 2;
    });
}
