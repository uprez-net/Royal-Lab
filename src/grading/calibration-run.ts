import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ResultSchema } from '#contracts/result';
import { SuiteSchema } from '#contracts/task';
import type { JudgeProfile } from '#contracts/judge';
import { DocumentWorkspace } from '#src/environments/documents';
import { gradeDeterministic } from '#src/grading/deterministic';
import { gradeSemantic, hashObject, JUDGE_SDK_VERSION, scopeCriterion } from '#src/grading/judge';
import { jsonText, readJson, sha256 } from '#src/io';
import { discover } from '#tasks/discover';
import { validateTask } from '#tasks/validate';
import type { CalibrationLabellingExample } from '#fixtures/authoring/calibration';

// Calibration run (#21): the release judge pair grades every example of the
// labelling pack in `calibration` mode. Labels are never read here and never
// reach a judge; receipts are matched to reviewer labels afterwards. Each
// example's scope is rebuilt from the real task documents and must hash to the
// pack's evidence hash before any request. Spend is bounded: each example
// reserves the profile's per-call ceiling against `maxUsd` and settles to the
// recorded judge cost (unknown cost keeps the reservation).
export async function runCalibration(
  root: string,
  options: {
    packPath: string;
    profile: JudgeProfile;
    credentials: Record<string, string>;
    outDir: string;
    maxUsd: number;
    allowPaid: boolean;
    fetch?: typeof globalThis.fetch;
  },
) {
  const pack = (await readJson(path.join(root, options.packPath))) as {
    id: string;
    version: string;
    examples: CalibrationLabellingExample[];
  };
  const mode = options.fetch ? ('offline-control' as const) : ('calibration' as const);
  if (mode === 'calibration' && (!options.allowPaid || options.profile.purpose !== 'release'))
    throw new Error('CALIBRATION_REQUIRES_RELEASE_PROFILE_AND_PAID_OPT_IN');
  const tasks = new Map((await discover(root)).map((entry) => [entry.task.id, entry.task]));
  const suites = await Promise.all(
    (await readdir(path.join(root, 'suites')))
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => ({
        file: `suites/${file}`,
        suite: SuiteSchema.parse(await readJson(path.join(root, 'suites', file))),
      })),
  );
  const runtime = {
    nodeVersion: process.version,
    lockfileHash: sha256(await readFile(path.join(root, 'pnpm-lock.yaml'))),
    sdkVersion: JUDGE_SDK_VERSION,
  };
  await mkdir(options.outDir, { recursive: true });
  await mkdir(path.join(root, 'tmp'), { recursive: true });
  const scratch = await mkdtemp(path.join(root, 'tmp/calibration-run-'));
  const reservation = options.profile.limits.maxCostUsd;
  let spentUsd = 0;
  const results: {
    id: string;
    receipt: string | null;
    verdicts: Record<string, string>;
    costUsd: number | null;
    skipped: string | null;
  }[] = [];
  try {
    for (const example of pack.examples) {
      if (spentUsd + reservation > options.maxUsd) {
        results.push({
          id: example.id,
          receipt: null,
          verdicts: {},
          costUsd: 0,
          skipped: 'CALIBRATION_BUDGET_EXHAUSTED',
        });
        continue;
      }
      const task = tasks.get(example.taskId);
      if (!task) throw new Error(`CALIBRATION_TASK_MISSING: ${example.taskId}`);
      const suite = suites.find((item) => item.suite.cases.includes(task.id));
      if (!suite) throw new Error(`CALIBRATION_SUITE_MISSING: ${task.id}`);
      const { rubric } = await validateTask(root, task);
      const criterion = rubric.criteria.find((item) => item.id === example.criterionId);
      if (criterion?.method !== 'semantic') throw new Error('CALIBRATION_CRITERION_NOT_SEMANTIC');
      const directory = path.join(scratch, example.id);
      const outputs = path.join(directory, 'outputs');
      await mkdir(directory, { recursive: true });
      const workspace = await DocumentWorkspace.create(root, structuredClone(task), outputs, {
        evidenceRoot: directory,
      });
      const artifacts = [];
      for (const file of example.scope.deliverables) {
        await writeFile(path.join(outputs, file.path), file.text);
        artifacts.push({ path: file.path, sha256: sha256(file.text) });
      }
      const documents = workspace.snapshot();
      // The rebuilt scope must be exactly the scope the reviewer labels.
      const scope = await scopeCriterion(criterion, outputs, artifacts, documents);
      if (hashObject(scope) !== example.evidenceHash)
        throw new Error(`CALIBRATION_SCOPE_CHANGED: ${example.id}`);
      const execution = ResultSchema.parse({
        schemaVersion: '1.1.0',
        runId: `calibration-${example.id}`,
        taskId: task.id,
        taskVersion: task.version,
        profile: suite.suite.profile,
        trial: 0,
        status: 'completed',
        reason: null,
        gradingStatus: 'ungraded',
        strictSuccess: false,
        criticalGatesPassed: null,
        criteria: [],
        outcomeId: null,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          candidateCostUsd: 0,
          judgeCostUsd: null,
          durationMs: 0,
          toolAttempts: 0,
          toolExecutions: 0,
          committedEffects: 0,
        },
        artifacts,
      });
      const deterministic = await gradeDeterministic(rubric, outputs, execution, {
        mode: 'offline-control',
      });
      spentUsd += reservation;
      const receipt = await gradeSemantic(rubric, deterministic, outputs, documents, {
        profile: options.profile,
        credentials: options.credentials,
        allowPaid: options.allowPaid,
        mode,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        runtime,
        executionEvidenceHash: hashObject({
          calibrationExample: example.id,
          scope: example.evidenceHash,
        }),
        ...(mode === 'calibration' ? { readiness: { root, suite: suite.file } } : {}),
      });
      const costUsd = receipt.result.usage.judgeCostUsd;
      spentUsd += (costUsd ?? reservation) - reservation;
      const file = `${example.id}.json`;
      await writeFile(path.join(options.outDir, file), jsonText(receipt), { flag: 'wx' });
      const selected = receipt.criteria.find((item) => item.criterionId === example.criterionId)!;
      results.push({
        id: example.id,
        receipt: file,
        verdicts: Object.fromEntries(
          selected.judges.map((judge) => [judge.judgeId, judge.verdict]),
        ),
        costUsd,
        skipped: null,
      });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const summary = {
    schemaVersion: '1.0.0',
    pack: `${pack.id}@${pack.version}`,
    profile: `${options.profile.id}@${options.profile.version}`,
    mode,
    spentUsd,
    results,
    note: 'Raw judge verdicts only. Reviewer labels are matched afterwards; nothing here is a label.',
  };
  await writeFile(path.join(options.outDir, 'summary.json'), jsonText(summary), { flag: 'wx' });
  return summary;
}
