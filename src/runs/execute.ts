import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { redact, type Config } from '#src/config';
import { discover } from '#tasks/discover';
import { preflight, validateTask } from '#tasks/validate';
import { DocumentWorkspace, DOCUMENT_TOOL_SCHEMAS } from '#src/environments/documents';
import { VerificationPlanSchema } from '#src/grading/verification';
import { runCandidate } from '#src/harness/loop';
import { RunManifestSchema, type CaseResult } from '#contracts/result';
import { readScoped, sha256, jsonText } from '#src/io';
import { stableJson } from '#src/environments/session';
const exec = promisify(execFile);
// One explicitly selected trial. Repeated/concurrent suite orchestration is issue #16.
export async function executeDocumentTrial(
  root: string,
  taskId: string,
  suiteFile: string,
  config: Config,
  verificationFile: string,
  allowPaid: boolean,
) {
  if (!allowPaid)
    throw new Error(
      'PAID_EXECUTION_DISABLED: use --allow-paid only for an intentional candidate request',
    );
  const readiness = await preflight(root, suiteFile, true);
  const runId = `run-${randomUUID()}`;
  const directory = path.join(root, 'results', runId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'preflight.json'), jsonText(readiness), { flag: 'wx' });
  if (!readiness.valid) return { status: 'blocked-input', runId, directory, preflight: readiness };
  let started = false;
  try {
    if (readiness.suite.profile !== 'documents' || config.profile !== 'documents')
      throw new Error(
        'CLI_PROFILE_UNSUPPORTED: this trial command currently executes documents; use the tested minimum canonical fixed-tools harness API',
      );
    if (config.repeats !== 1 || config.concurrency !== 1)
      throw new Error(
        'SINGLE_TRIAL_ONLY: configure repeats=1 and concurrency=1; suite orchestration belongs to #16',
      );
    if (!readiness.suite.cases.includes(taskId)) throw new Error('TASK_NOT_SELECTED_IN_SUITE');
    const entry = (await discover(root)).find((item) => item.task.id === taskId);
    if (!entry) throw new Error('TASK_NOT_FOUND');
    const { rubric, directory: taskDirectory } = await validateTask(root, entry.task);
    if (verificationFile !== entry.task.verificationPath)
      throw new Error('VERIFIER_NOT_DECLARED: use the task-frozen grading verifier');
    if (!verificationFile.startsWith('grading/'))
      throw new Error('VERIFIER_PATH_DENIED: specify a case-local grading/ file');
    const planBytes = await readScoped(taskDirectory, verificationFile);
    if (sha256(planBytes) !== entry.task.verificationHash)
      throw new Error('VERIFIER_HASH_MISMATCH');
    const plan = VerificationPlanSchema.parse(JSON.parse(planBytes.toString('utf8')));
    if (plan.review.status !== 'approved') throw new Error('VERIFIER_REVIEW_PENDING');
    if (plan.taskId !== taskId || plan.rubricVersion !== rubric.version)
      throw new Error('VERIFIER_IDENTITY_MISMATCH');
    for (const assertion of plan.assertions) {
      if (!rubric.criteria.some((criterion) => criterion.id === assertion.criterionId))
        throw new Error('VERIFIER_UNKNOWN_CRITERION');
      if (
        'path' in assertion &&
        !entry.task.deliverables.some((file) => file.path === assertion.path)
      )
        throw new Error('VERIFIER_UNKNOWN_DELIVERABLE');
    }
    for (const criterion of rubric.criteria.filter(
      (item) => item.method === 'deterministic' && item.severity === 'critical',
    ))
      if (
        !plan.assertions.some(
          (assertion) => assertion.criterionId === criterion.id && assertion.kind === 'prose',
        )
      )
        throw new Error(`PROSE_VERIFIER_MISSING: ${criterion.id}`);
    const task = structuredClone(entry.task);
    for (const name of Object.keys(task.limits) as (keyof typeof task.limits)[])
      task.limits[name] = Math.min(task.limits[name], config.limits[name]);
    task.limits.maxCostUsd = Math.min(task.limits.maxCostUsd, config.runSpendCapUsd);
    const workspace = await DocumentWorkspace.create(root, task, path.join(directory, 'outputs'), {
      ...(config.binaryParser ? { binaryParser: config.binaryParser } : {}),
      evidenceRoot: directory,
    });
    const systemPrompt = await readFile(
      fileURLToPath(new URL('../harness/prompts/documents.txt', import.meta.url)),
      'utf8',
    );
    if (readiness.profile.systemPromptHash !== sha256(systemPrompt))
      throw new Error('PROMPT_PROFILE_MISMATCH');
    const candidate = config.candidate;
    if (!candidate || !candidate.pricing)
      throw new Error(
        'CANDIDATE_CONFIG_MISSING: exact provider/model/settings and frozen pricing are required',
      );
    if (!['direct', 'gateway'].includes(candidate.provider))
      throw new Error('CANDIDATE_PROVIDER_UNSUPPORTED');
    // Read only the explicitly named credential, after the entire suite and local inputs pass.
    const apiKey =
      candidate.apiKey ?? (candidate.apiKeyEnv ? process.env[candidate.apiKeyEnv] : undefined);
    if (!apiKey)
      throw new Error('CANDIDATE_CREDENTIAL_MISSING: configure locally; never paste keys in chat');
    const adapterOptions = { model: candidate.model, parameters: candidate.parameters, apiKey };
    const adapter =
      candidate.provider === 'direct'
        ? await (await import('#src/harness/adapters/direct')).directAdapter(adapterOptions)
        : await (await import('#src/harness/adapters/gateway')).gatewayAdapter(adapterOptions);
    const git = async (...args: string[]) =>
      (await exec('git', ['-C', root, ...args], { windowsHide: true })).stdout.trim();
    const revision = await git('rev-parse', 'HEAD');
    if (await git('status', '--porcelain', '--untracked-files=all'))
      throw new Error(
        'RUNNER_DIRTY: checkpoint implementation and dataset changes before benchmark execution',
      );
    const snapshot = {
      task: entry.task,
      rubric,
      verification: plan,
      taskHash: sha256(stableJson(entry.task)),
      rubricHash: sha256(jsonText(rubric)),
      sourceRubricHash: entry.task.rubricHash,
      verificationHash: sha256(jsonText(plan)),
      sourceVerificationHash: sha256(planBytes),
      runnerRevision: revision,
      lockfileHash: sha256(await readScoped(root, 'pnpm-lock.yaml')),
      nodeVersion: process.version,
    };
    await writeFile(path.join(directory, 'grading-inputs.json'), jsonText(snapshot), {
      flag: 'wx',
    });
    const toolSchemas = Object.fromEntries(
      task.tools.map((tool) => [
        tool.name,
        z.toJSONSchema(DOCUMENT_TOOL_SCHEMAS[tool.name as keyof typeof DOCUMENT_TOOL_SCHEMAS]),
      ]),
    );
    const manifest = RunManifestSchema.parse({
      schemaVersion: '1.0.0',
      runId,
      createdAt: new Date().toISOString(),
      suiteId: readiness.suite.id,
      suiteVersion: readiness.suite.version,
      suiteHash: sha256(await readScoped(root, suiteFile)),
      profile: 'documents',
      profileHash: sha256(await readScoped(root, 'profiles/documents.json')),
      policyHash: sha256(
        stableJson(
          task.inputs.filter((input) => input.kind === 'policy').map((input) => input.sha256),
        ),
      ),
      systemPromptHash: sha256(systemPrompt),
      toolSchemaHash: sha256(stableJson(toolSchemas)),
      parserHash: sha256(stableJson(workspace.snapshot().map((document) => document.parserHash))),
      fixturesHash: task.fixtureHash,
      operatorScriptHash: sha256('not-applicable:documents'),
      guriRevision: null,
      candidate: {
        provider: adapter.provider,
        model: adapter.modelId,
        parameters: adapter.parameters,
      },
      judges: [],
      pricingSnapshot: {
        version: candidate.pricing.version,
        asOf: candidate.pricing.asOf,
        sha256: sha256(stableJson(candidate.pricing)),
      },
      limits: task.limits,
      repeats: 1,
      cases: await Promise.all(
        readiness.cases.map(async (selected) => {
          const selectedEntry = (await discover(root)).find(
            (item) => item.task.id === selected.taskId,
          )!;
          return {
            taskId: selected.taskId,
            trial: 0,
            taskHash: sha256(stableJson(selectedEntry.task)),
            status: selected.taskId === taskId ? 'pending' : 'excluded',
            reason:
              selected.taskId === taskId ? null : `Explicit single-trial selection: ${taskId}`,
          };
        }),
      ),
    });
    await writeFile(path.join(directory, 'manifest.json'), jsonText(manifest), { flag: 'wx' });
    let result: CaseResult;
    try {
      started = true;
      result = await runCandidate({
        allowPaid: true,
        runId,
        task,
        adapter,
        workspace,
        saveDirectory: directory,
        systemPrompt,
        pricing: candidate.pricing,
        environmentFingerprint: {
          runnerRevision: revision,
          lockfileHash: snapshot.lockfileHash,
          nodeVersion: process.version,
          gradingInputsHash: sha256(jsonText(snapshot)),
        },
      });
    } catch (error) {
      manifest.cases.find((item) => item.taskId === taskId)!.status = 'infrastructure-error';
      manifest.cases.find((item) => item.taskId === taskId)!.reason =
        'Controller execution failed; inspect preserved evidence';
      await writeFile(path.join(directory, 'manifest.json'), jsonText(manifest));
      throw error;
    }
    manifest.cases.find((item) => item.taskId === taskId)!.status = result.status;
    manifest.cases.find((item) => item.taskId === taskId)!.reason = result.reason;
    await writeFile(path.join(directory, 'manifest.json'), jsonText(manifest));
    return {
      status: result.status,
      runId,
      directory,
      strictSuccess: result.strictSuccess,
      gradingStatus: result.gradingStatus,
    };
  } catch (error) {
    const status = started ? 'infrastructure-error' : 'blocked-input';
    const reason = String(redact(error instanceof Error ? error.message : error));
    const failure = {
      schemaVersion: '1.0.0',
      runId,
      status,
      reason,
      selectedCases: readiness.cases,
    };
    await writeFile(path.join(directory, 'setup-error.json'), jsonText(failure), { flag: 'wx' });
    return { status, runId, directory, reason };
  }
}
