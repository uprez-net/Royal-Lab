import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Instant } from '#contracts/common';
import { JudgeCalibrationSchema, type JudgeProfile } from '#contracts/judge';
import { calibrationProfileHash } from '#src/grading/judge';
import { inspectCalibration } from '#src/grading/adjudicate';
import { jsonText, readJson, sha256 } from '#src/io';
import type { CalibrationLabellingExample } from '#fixtures/authoring/calibration';

// Reviewer labels for the calibration labelling pack. Every example must carry
// an explicit pass/fail from the named reviewer; nothing is inferred.
export const CalibrationLabelsSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  pack: z.string().min(1),
  reviewer: z.string().min(1),
  reviewedAt: Instant,
  timestampNote: z.string(),
  labels: z.record(z.string(), z.enum(['pass', 'fail'])),
  notes: z.record(z.string(), z.string()).default({}),
});

// Record a calibration pack (#21): the reviewer's labels, bound to one
// calibration run's receipts copied into the repository, then inspected. The
// pack's own review stays draft until the owner approves the inspected result;
// only then may a release profile carry its hash.
export async function recordCalibration(
  root: string,
  options: {
    packPath: string;
    labelsPath: string;
    receiptsDir: string;
    profile: JudgeProfile;
    outPath: string;
    receiptRoot?: string;
  },
) {
  const pack = (await readJson(path.join(root, options.packPath))) as {
    id: string;
    version: string;
    examples: CalibrationLabellingExample[];
  };
  const labels = CalibrationLabelsSchema.parse(await readJson(path.join(root, options.labelsPath)));
  if (labels.pack !== `${pack.id}@${pack.version}`)
    throw new Error('CALIBRATION_LABELS_PACK_MISMATCH');
  const missing = pack.examples.filter((example) => !labels.labels[example.id]);
  if (missing.length)
    throw new Error(`CALIBRATION_LABELS_MISSING: ${missing.map((item) => item.id).join(', ')}`);
  const unknown = Object.keys(labels.labels).filter(
    (id) => !pack.examples.some((example) => example.id === id),
  );
  if (unknown.length) throw new Error(`CALIBRATION_LABELS_UNKNOWN: ${unknown.join(', ')}`);
  const receiptRoot =
    options.receiptRoot ??
    `fixtures/judge-calibration/receipts/${options.profile.id}-${options.profile.version}`;
  await mkdir(path.join(root, receiptRoot), { recursive: true });
  const examples = [];
  for (const example of pack.examples) {
    const receiptPath = `${receiptRoot}/${example.id}.json`;
    await copyFile(
      path.join(options.receiptsDir, `${example.id}.json`),
      path.join(root, receiptPath),
    );
    examples.push({
      id: example.id,
      scenario: example.scenario,
      scope: example.scope,
      evidenceHash: example.evidenceHash,
      expected: labels.labels[example.id]!,
      review: {
        status: 'approved' as const,
        reviewer: labels.reviewer,
        reviewedAt: labels.reviewedAt,
        notes: [labels.timestampNote, labels.notes[example.id]].filter(Boolean).join(' '),
      },
      receiptPath,
      receiptHash: sha256(await readFile(path.join(root, receiptPath))),
      adjudicationPaths: [],
    });
  }
  const calibration = JudgeCalibrationSchema.parse({
    schemaVersion: '1.0.0',
    id: `calibration-${options.profile.id}`,
    version: '1.0.0',
    profileHash: calibrationProfileHash(options.profile),
    review: {
      status: 'draft',
      reviewer: null,
      reviewedAt: null,
      notes: 'Owner approval of the inspected calibration result is pending.',
    },
    examples,
  });
  await writeFile(path.join(root, options.outPath), jsonText(calibration));
  const inspected = await inspectCalibration(root, calibration, options.profile);
  return {
    outPath: options.outPath,
    ready: inspected.ready,
    pending: inspected.pending,
    examples: inspected.examples.map((item) => ({
      id: item.id,
      scenario: item.scenario,
      expected: item.expected,
      judges: Object.fromEntries(item.judges.map((judge) => [judge.judgeId, judge.verdict])),
      matches: item.matches,
      disagreement: item.disagreement,
    })),
  };
}
