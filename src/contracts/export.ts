import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskSchema, SuiteSchema } from '#contracts/task';
import { RubricSchema } from '#contracts/rubric';
import { ProfileSchema } from '#contracts/profile';
import { ResultSchema, RunManifestSchema } from '#contracts/result';
import { TraceEventSchema } from '#contracts/trace';
import { ProvenanceSchema } from '#fixtures/provenance';
import { WorldSchema, FixtureSchema } from '#fixtures/world';
import { jsonText } from '#src/io';
import { VerificationPlanSchema } from '#src/grading/verification';
import { InteractionScriptSchema } from '#src/harness/operator';
import { NormalizedDocumentSchema } from '#src/documents/normalize';
import { OracleSchema } from '#src/grading/oracles/guri';
import {
  BridgeControlsSchema,
  RecordingPortPolicySchema,
  StaleVersionControlSchema,
  CanonicalSnapshotSchema,
  CanonicalStateEvidenceSchema,
  FixtureInitializationSchema,
  RecordingPortReceiptSchema,
} from '#contracts/operational';
import {
  JudgeProfileSchema,
  JudgeScopeSchema,
  JudgeResponseSchema,
  JudgeRecordSchema,
  SemanticReceiptSchema,
  HumanAdjudicationSchema,
  JudgeCalibrationSchema,
} from '#contracts/judge';
import { CaseSeedSchema, CaseEnvironmentSchema, CaseControlsSchema } from '#contracts/authoring';

export async function exportSchemas(root: string) {
  const directory = path.join(root, 'schemas');
  await mkdir(directory, { recursive: true });
  const schemas = {
    task: TaskSchema,
    suite: SuiteSchema,
    rubric: RubricSchema,
    profile: ProfileSchema,
    result: ResultSchema,
    manifest: RunManifestSchema,
    trace: TraceEventSchema,
    provenance: ProvenanceSchema,
    world: WorldSchema,
    fixture: FixtureSchema,
    verification: VerificationPlanSchema,
    interactions: InteractionScriptSchema,
    document: NormalizedDocumentSchema,
    oracle: OracleSchema,
    'bridge-controls': BridgeControlsSchema,
    'recording-port-policy': RecordingPortPolicySchema,
    'stale-version-control': StaleVersionControlSchema,
    'canonical-snapshot': CanonicalSnapshotSchema,
    'canonical-state-evidence': CanonicalStateEvidenceSchema,
    'fixture-initialization': FixtureInitializationSchema,
    'recording-port-receipt': RecordingPortReceiptSchema,
    'judge-profile': JudgeProfileSchema,
    'judge-scope': JudgeScopeSchema,
    'judge-response': JudgeResponseSchema,
    'judge-record': JudgeRecordSchema,
    'semantic-receipt': SemanticReceiptSchema,
    'human-adjudication': HumanAdjudicationSchema,
    'judge-calibration': JudgeCalibrationSchema,
    'case-seed': CaseSeedSchema,
    'case-environment': CaseEnvironmentSchema,
    'case-controls': CaseControlsSchema,
  };
  for (const [name, schema] of Object.entries(schemas)) {
    await writeFile(
      path.join(directory, `${name}.schema.json`),
      jsonText(z.toJSONSchema(schema, { target: 'draft-2020-12' })),
      'utf8',
    );
  }
  return {
    schemas: Object.keys(schemas),
    note: 'Cross-file and semantic invariants additionally require Royal-Lab preflight.',
  };
}
