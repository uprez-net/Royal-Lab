import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ResultSchema } from '#contracts/result';
import { RubricSchema } from '#contracts/rubric';
import { TaskSchema } from '#contracts/task';
import { TraceEventSchema } from '#contracts/trace';
import { VerificationPlanSchema } from '#src/grading/verification';
import { NormalizedDocumentSchema } from '#src/documents/normalize';
import { gradeDeterministic } from '#src/grading/deterministic';
import { readScoped, jsonText, sha256, securePath } from '#src/io';
import { stableJson } from '#src/environments/session';
export async function regradeSaved(
  directory: string,
  options: { mode?: 'benchmark' | 'offline-control' } = {},
) {
  const receipt = JSON.parse(
    (await readScoped(directory, 'execution-receipt.json')).toString('utf8'),
  );
  for (const [file, key] of [
    ['result.json', 'resultHash'],
    ['trace.jsonl', 'traceHash'],
    ['documents.json', 'documentsHash'],
    ['configuration.json', 'configurationHash'],
    ['prompt.txt', 'promptHash'],
  ] as const)
    if (receipt[key] !== sha256(await readScoped(directory, file)))
      throw new Error(`EXECUTION_EVIDENCE_CHANGED: ${file}`);
  const snapshotBytes = await readScoped(directory, 'grading-inputs.json');
  const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
  const configuration = JSON.parse(
    (await readScoped(directory, 'configuration.json')).toString('utf8'),
  );
  const { configurationHash, ...fingerprint } = configuration;
  if (
    configurationHash !== sha256(stableJson(fingerprint)) ||
    configuration.environment?.gradingInputsHash !== sha256(snapshotBytes)
  )
    throw new Error('GRADING_CONFIGURATION_CHANGED');
  const task = TaskSchema.parse(snapshot.task);
  const rubric = RubricSchema.parse(snapshot.rubric);
  const plan = VerificationPlanSchema.parse(snapshot.verification);
  if (task.verificationHash && task.verificationHash !== snapshot.sourceVerificationHash)
    throw new Error('GRADING_VERIFIER_SOURCE_CHANGED');
  if (
    snapshot.taskHash !== sha256(stableJson(task)) ||
    snapshot.rubricHash !== sha256(jsonText(rubric)) ||
    snapshot.verificationHash !== sha256(jsonText(plan))
  )
    throw new Error('GRADING_SNAPSHOT_CHANGED');
  const result = ResultSchema.parse(
    JSON.parse((await readScoped(directory, 'result.json')).toString('utf8')),
  );
  if (result.taskId !== task.id || result.taskVersion !== task.version || rubric.taskId !== task.id)
    throw new Error('GRADING_IDENTITY_MISMATCH');
  if (
    receipt.runId !== result.runId ||
    configuration.taskId !== task.id ||
    configuration.rubricHash !== snapshot.sourceRubricHash
  )
    throw new Error('GRADING_EXECUTION_MISMATCH');
  const documents = (
    JSON.parse((await readScoped(directory, 'documents.json')).toString('utf8')) as unknown[]
  ).map((item) => NormalizedDocumentSchema.parse(item));
  for (const document of documents) {
    const source = task.inputs.find((input) => input.id === document.id);
    const frozen = configuration.parserHashes.find(
      (item: { source: string }) => item.source === document.id,
    );
    if (
      !source ||
      source.sha256 !== document.rawHash ||
      frozen?.extractHash !== document.extractHash ||
      document.extractHash !== sha256(jsonText({ units: document.units, gaps: document.gaps }))
    )
      throw new Error('GRADING_EVIDENCE_CHANGED');
  }
  // Parse trace without importing any candidate or judge client.
  const trace = (await readScoped(directory, 'trace.jsonl'))
    .toString('utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => TraceEventSchema.parse(JSON.parse(line)));
  if (
    trace.some(
      (event, index) =>
        event.sequence !== index || event.runId !== result.runId || event.taskId !== task.id,
    )
  )
    throw new Error('GRADING_TRACE_IDENTITY_MISMATCH');
  const graded = await gradeDeterministic(rubric, await securePath(directory, 'outputs'), result, {
    ...options,
    plan,
    trace,
    sources: documents.map((document) => ({
      id: document.id,
      locators: document.units.map((unit) => unit.locator),
    })),
  });
  const file = `grade-${randomUUID()}.json`;
  await writeFile(path.join(directory, file), jsonText(graded), { flag: 'wx' });
  return { file, result: graded };
}
