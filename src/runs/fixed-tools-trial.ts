import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DisposableDatabase } from '#src/environments/guri/database';
import { GuriBridge } from '#src/environments/guri/bridge';
import { RecordingPorts } from '#src/environments/guri/ports';
import { saveIndependentEvidence } from '#src/environments/guri/evidence';
import { DocumentWorkspace } from '#src/environments/documents';
import { FixedToolsEnvironment, FIXED_TOOL_SCHEMAS } from '#src/environments/fixed-tools';
import { Session, stableJson } from '#src/environments/session';
import { ScriptedOperator } from '#src/harness/operator';
import { runCandidate } from '#src/harness/loop';
import { VerificationPlanSchema } from '#src/grading/verification';
import { jsonText, readScoped, sha256 } from '#src/io';
import { validateTask } from '#tasks/validate';
import type { AdapterFactory, TrialExecutor } from '#runs/sweep';

// Fixed-tools trial (#21): every trial gets its own freshly created and seeded
// disposable PostgreSQL database, its own document workspace and its own bridge
// session, so repeats cannot share state. The database is dropped after the
// trial; independent before/after state, port effects and controller events are
// saved into the trial bundle for offline grading. `controlUrl` is an explicit
// disposable control-database connection; no ambient DATABASE_URL is read.
export function fixedToolsTrialExecutor(
  adapters: AdapterFactory,
  options: { controlUrl: string },
): TrialExecutor {
  return async ({ root, trial, task: source, configuration, directory, mode }) => {
    const validated = await validateTask(root, source);
    const { rubric, directory: taskDirectory, environment: environmentSpec } = validated;
    if (!environmentSpec) throw new Error('FIXED_TOOLS_ENVIRONMENT_NOT_DECLARED');
    if (!source.verificationPath || !source.verificationHash)
      throw new Error('VERIFIER_NOT_DECLARED');
    const planBytes = await readScoped(taskDirectory, source.verificationPath);
    if (sha256(planBytes) !== source.verificationHash) throw new Error('VERIFIER_HASH_MISMATCH');
    const verification = VerificationPlanSchema.parse(JSON.parse(planBytes.toString('utf8')));
    if (mode === 'benchmark' && verification.review.status !== 'approved')
      throw new Error('VERIFIER_REVIEW_PENDING');
    const task = structuredClone(source);
    const snapshot = {
      task: source,
      rubric,
      verification,
      taskHash: sha256(stableJson(source)),
      rubricHash: sha256(jsonText(rubric)),
      sourceRubricHash: source.rubricHash,
      verificationHash: sha256(jsonText(verification)),
      sourceVerificationHash: sha256(planBytes),
      trialId: trial.trialId,
      configurationId: configuration.id,
      repeat: trial.repeat,
      nodeVersion: process.version,
    };
    await writeFile(path.join(directory, 'grading-inputs.json'), jsonText(snapshot), {
      flag: 'wx',
    });
    const adapter = await adapters(configuration);
    if (mode === 'offline-control' && adapter.executionMode !== 'offline-control')
      throw new Error('OFFLINE_CONTROL_REQUIRES_MOCK_TRANSPORT');
    const database = await DisposableDatabase.create(
      options.controlUrl,
      await readFile(path.join(root, '.cache/guri/schema.sql'), 'utf8'),
    );
    try {
      await database.seedCase(environmentSpec.seed, task.id);
      const before = await database.snapshot();
      const workspace = await DocumentWorkspace.create(
        root,
        task,
        path.join(directory, 'outputs'),
        {
          evidenceRoot: directory,
        },
      );
      const session = new Session(
        environmentSpec.session.sessionId,
        environmentSpec.session.ownerId,
      );
      const bridge = new GuriBridge(
        path.join(root, '.guri'),
        path.join(root, '.cache/guri'),
        database.url,
        task.clock.instant,
        environmentSpec.bridge,
      );
      const environment = new FixedToolsEnvironment(
        workspace,
        bridge,
        session,
        new ScriptedOperator(environmentSpec.operator, mode),
        environmentSpec.controller,
      );
      const result = await runCandidate({
        allowPaid: mode === 'benchmark',
        runId: trial.trialId,
        trial: trial.repeat,
        task,
        adapter,
        workspace,
        saveDirectory: directory,
        executionProfile: 'fixed-tools',
        systemPrompt: await readFile(
          path.join(root, 'src/harness/prompts/fixed-tools.txt'),
          'utf8',
        ),
        pricing: configuration.pricing,
        schemas: FIXED_TOOL_SCHEMAS,
        execute: environment.execute,
        attachTrace: environment.attachTrace,
        afterExecution: environment.afterExecution,
        committedEffects: environment.committedEffects,
        environmentFingerprint: {
          gradingInputsHash: sha256(jsonText(snapshot)),
          experimentTrial: trial.trialId,
          configurationId: configuration.id,
          database: database.name,
        },
      });
      await saveIndependentEvidence(directory, database, before, new RecordingPorts());
      await writeFile(
        path.join(directory, 'controller-events.json'),
        jsonText(environment.controllerEvents),
        { flag: 'wx' },
      );
      return result;
    } finally {
      await database.dispose();
    }
  };
}
