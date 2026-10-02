import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import type { Rubric } from '#contracts/rubric';
import { ResultSchema, type CaseResult } from '#contracts/result';
import {
  HumanAdjudicationSchema,
  JudgeCalibrationSchema,
  CalibrationScenario,
  SemanticReceiptSchema,
  type SemanticReceipt,
  type JudgeProfile,
} from '#contracts/judge';
import {
  calibrationProfileHash,
  checkEvidence,
  hashObject,
  verifySemanticRecords,
} from '#src/grading/judge';
import { readScoped, jsonText, sha256 } from '#src/io';

export function combineSemantic(
  rubric: Rubric,
  deterministic: CaseResult,
  semantic: SemanticReceipt['criteria'],
): CaseResult {
  const expected = rubric.criteria.filter((criterion) => criterion.method === 'semantic');
  if (
    new Set(semantic.map((item) => item.criterionId)).size !== semantic.length ||
    semantic.length !== expected.length ||
    semantic.some((item) => !expected.some((criterion) => criterion.id === item.criterionId))
  )
    throw new Error('SEMANTIC_COVERAGE_MISMATCH');
  if (
    deterministic.criteria.length !== rubric.criteria.length ||
    rubric.criteria.some(
      (criterion) => deterministic.criteria.filter((row) => row.id === criterion.id).length !== 1,
    )
  )
    throw new Error('DETERMINISTIC_COVERAGE_MISMATCH');
  const criteria = rubric.criteria.map((criterion) => {
    const row = deterministic.criteria.find((item) => item.id === criterion.id)!;
    if (row.mandatory !== criterion.mandatory || row.severity !== criterion.severity)
      throw new Error('CRITERION_METADATA_MISMATCH');
    if (criterion.method === 'deterministic') return structuredClone(row);
    const evaluated = semantic.find((item) => item.criterionId === criterion.id)!;
    const verdicts = evaluated.judges.map((judge) => judge.verdict);
    const disagreement = new Set(verdicts).size > 1;
    const verdict =
      verdicts.length === 0 || verdicts.includes('error') || disagreement
        ? 'error'
        : verdicts.every((item) => item === 'pass')
          ? 'pass'
          : 'fail';
    return {
      ...row,
      verdict: verdict as 'pass' | 'fail' | 'error',
      reason: disagreement
        ? 'Independent judges disagree; human review pending'
        : verdict === 'error'
          ? 'Judge error; inspect preserved individual records'
          : `All configured judges returned ${verdict}`,
      evidencePaths: criterion.deliverables,
    };
  });
  const error = semantic.some(
    (item) => item.judges.some((judge) => judge.verdict === 'error') || item.disagreement,
  );
  const unresolved = criteria.some((criterion) =>
    ['error', 'ungraded'].includes(criterion.verdict),
  );
  const critical = criteria.filter((criterion) => criterion.severity === 'critical');
  const mandatory = criteria.filter((criterion) => criterion.mandatory);
  const costs = semantic.flatMap((item) => item.judges.map((judge) => judge.usage.costUsd));
  return ResultSchema.parse({
    ...deterministic,
    criteria,
    gradingStatus: error ? 'judge-error' : unresolved ? 'ungraded' : 'graded',
    strictSuccess:
      deterministic.status === 'completed' &&
      !unresolved &&
      mandatory.length > 0 &&
      mandatory.every((criterion) => criterion.verdict === 'pass'),
    criticalGatesPassed:
      critical.length === 0 ||
      critical.some((criterion) => ['error', 'ungraded'].includes(criterion.verdict))
        ? null
        : critical.every((criterion) => criterion.verdict === 'pass'),
    usage: {
      ...deterministic.usage,
      judgeCostUsd: costs.some((cost) => cost === null)
        ? null
        : costs.reduce<number>((sum, cost) => sum + cost!, 0),
    },
  });
}

// The caller must supply an actual human's decision. This API never manufactures one
// and never updates the receipt, score, judge verdicts, or original execution.
export async function appendAdjudication(
  directory: string,
  receiptPath: string,
  decision: Pick<
    z.infer<typeof HumanAdjudicationSchema>,
    | 'reviewer'
    | 'reviewedAt'
    | 'origin'
    | 'criterionId'
    | 'verdict'
    | 'explanation'
    | 'evidence'
    | 'supersedes'
  >,
) {
  const bytes = await readScoped(directory, receiptPath);
  const receipt = SemanticReceiptSchema.parse(JSON.parse(bytes.toString('utf8')));
  verifySemanticRecords(receipt);
  const criterion = receipt.criteria.find((item) => item.criterionId === decision.criterionId);
  if (!criterion?.scope) throw new Error('ADJUDICATION_SCOPE_UNAVAILABLE');
  checkEvidence(criterion.scope, decision.evidence);
  if (decision.supersedes) {
    // A correction explicitly links an earlier record instead of overwriting it.
    const { walk } = await import('#src/io');
    let found = false;
    for (const file of (await walk(directory)).filter((file) =>
      /^adjudication-[\w-]+\.json$/.test(file),
    )) {
      const previous = await readScoped(directory, file);
      if (sha256(previous) !== decision.supersedes) continue;
      const record = HumanAdjudicationSchema.parse(JSON.parse(previous.toString('utf8')));
      if (record.receiptHash !== sha256(bytes) || record.criterionId !== decision.criterionId)
        throw new Error('ADJUDICATION_SUPERSEDES_MISMATCH');
      found = true;
    }
    if (!found) throw new Error('ADJUDICATION_PREVIOUS_RECORD_MISSING');
  }
  const record = HumanAdjudicationSchema.parse({
    ...decision,
    schemaVersion: '1.0.0',
    id: `adjudication-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    receiptPath,
    receiptHash: sha256(bytes),
    judgeRecordHashes: criterion.judges.map(hashObject),
  });
  const file = `${record.id}.json`;
  await writeFile(path.join(directory, file), jsonText(record), { flag: 'wx' });
  return { file, record };
}

// Calibration inspection is offline and never sends reviewer labels to a judge.
export async function inspectCalibration(directory: string, value: unknown, profile: JudgeProfile) {
  const pack = JudgeCalibrationSchema.parse(value);
  const pending: string[] = [];
  const examples = [];
  if (pack.review.status !== 'approved') pending.push('Calibration review is pending');
  if (pack.profileHash !== calibrationProfileHash(profile))
    pending.push('Calibration configuration fingerprint does not match');
  if (new Set(pack.examples.map((example) => example.id)).size !== pack.examples.length)
    throw new Error('CALIBRATION_DUPLICATE_ID');
  if (new Set(pack.examples.map((example) => example.evidenceHash)).size !== pack.examples.length)
    throw new Error('CALIBRATION_DUPLICATE_EVIDENCE');
  for (const scenario of CalibrationScenario.options)
    if (
      !pack.examples.some(
        (example) => example.scenario === scenario && example.review.status === 'approved',
      )
    )
      pending.push(`Reviewer-labeled scenario pending: ${scenario}`);
  for (const example of pack.examples) {
    if (example.review.status !== 'approved') pending.push(`Example review pending: ${example.id}`);
    if (example.evidenceHash !== hashObject(example.scope))
      throw new Error('CALIBRATION_EVIDENCE_CHANGED');
    const bytes = await readScoped(directory, example.receiptPath);
    if (sha256(bytes) !== example.receiptHash) throw new Error('CALIBRATION_RECEIPT_CHANGED');
    const receipt = SemanticReceiptSchema.parse(JSON.parse(bytes.toString('utf8')));
    verifySemanticRecords(receipt);
    if (receipt.mode === 'offline-control')
      pending.push(`Mock judge evidence cannot establish calibration: ${example.id}`);
    if (
      calibrationProfileHash(receipt.profile) !== pack.profileHash ||
      receipt.profileHash !== hashObject(receipt.profile)
    )
      throw new Error('CALIBRATION_JUDGE_PROFILE_CHANGED');
    const criterion = receipt.criteria.find(
      (item) => item.criterionId === example.scope.criterion.id,
    );
    if (
      !criterion?.scope ||
      hashObject(criterion.scope) !== example.evidenceHash ||
      criterion.judges.length !== 2
    )
      throw new Error('CALIBRATION_JUDGE_EVIDENCE_CHANGED');
    const disagreement = new Set(criterion.judges.map((judge) => judge.verdict)).size > 1;
    const matches = criterion.judges.every((judge) => judge.verdict === example.expected);
    if (criterion.judges.some((judge) => judge.verdict === 'error'))
      pending.push(`Judge error: ${example.id}`);
    if (!matches) pending.push(`Judge calibration mismatch: ${example.id}`);
    const adjudications = [];
    for (const file of example.adjudicationPaths) {
      const record = HumanAdjudicationSchema.parse(
        JSON.parse((await readScoped(directory, file)).toString('utf8')),
      );
      if (
        record.receiptHash !== example.receiptHash ||
        record.criterionId !== criterion.criterionId ||
        hashObject(record.judgeRecordHashes) !== hashObject(criterion.judges.map(hashObject))
      )
        throw new Error('CALIBRATION_ADJUDICATION_CHANGED');
      checkEvidence(criterion.scope, record.evidence);
      adjudications.push(record);
    }
    if (disagreement && adjudications.length === 0)
      pending.push(`Human adjudication pending: ${example.id}`);
    examples.push({
      id: example.id,
      scenario: example.scenario,
      expected: example.expected,
      judges: criterion.judges,
      disagreement,
      matches,
      adjudications,
    });
  }
  return { ready: pending.length === 0 && profile.purpose === 'release', pending, examples };
}
