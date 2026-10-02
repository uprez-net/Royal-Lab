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
import { readJson } from '#src/io';

const HELP = `Royal-Lab 0.1 • NSW residential builder benchmark

Usage: pnpm lab <command> [arguments] [options]

  tui                            Interactive benchmark workbench
  list                           List authored cases and their review status
  describe <family/case>          Describe an authored case
  describe <family/case> --visible Inspect only the candidate-visible projection
  validate [--suite <path>]       Offline suite integrity (both splits by default)
  validate --for-run              Strict review/tool/execution readiness preflight
  validate --artifact <file> --kind result|trace|manifest
  fixtures generate [--check]     Create deterministic draft specimens / check drift
  fixtures lint                  Check privacy patterns and world references
  schemas export                 Export portable JSON Schemas
  config show [--config <file>]   Display explicit effective config with secrets redacted
  bridge prepare|check           Build or verify the pinned private canonical bridge
  run <task> --suite <path>       One reviewed document trial (--allow-paid required)
  grade <run-id>                 Regrade saved artifacts offline (--replay-judge <receipt>)
  grade <run-id> --judge-profile <file> --judge-credentials <file> --suite <path> --allow-paid
                                Opt-in scoped semantic judging of saved evidence
  report <run>                   Reserved for reports (#17)
  compare <run-a> <run-b>         Reserved for compatible comparisons (#17)

Options: --root <directory> --json --help
No API credentials are needed for authoring. See docs/configuration.md.
The 28-definition roadmap contains four draft specimens; no model scores exist.
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
      : ['suites/development.json', 'suites/held-out.json'];
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
  const reserved: Record<string, string> = {
    report: '#17',
    compare: '#17',
  };
  if (reserved[command]) {
    required(command === 'compare' ? 2 : 1);
    output({
      status: 'not-implemented',
      command,
      owningIssue: reserved[command],
      message: 'No candidate call, grading or successful benchmark receipt was produced.',
    });
    return 3;
  }
  throw new Error(`Unknown command: ${command}; see --help.`);
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
