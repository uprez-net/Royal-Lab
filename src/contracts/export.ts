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

export async function exportSchemas(root: string) {
  const directory = path.join(root, 'schemas'); await mkdir(directory, { recursive: true });
  const schemas = { task: TaskSchema, suite: SuiteSchema, rubric: RubricSchema, profile: ProfileSchema,
    result: ResultSchema, manifest: RunManifestSchema, trace: TraceEventSchema,
    provenance: ProvenanceSchema, world: WorldSchema, fixture: FixtureSchema };
  for (const [name, schema] of Object.entries(schemas)) {
    await writeFile(path.join(directory, `${name}.schema.json`), jsonText(z.toJSONSchema(schema, { target: 'draft-2020-12' })), 'utf8');
  }
  return { schemas: Object.keys(schemas), note: 'Cross-file and semantic invariants additionally require Royal-Lab preflight.' };
}
