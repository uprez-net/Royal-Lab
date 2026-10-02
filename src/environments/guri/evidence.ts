import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DisposableDatabase } from '#src/environments/guri/database';
import type { RecordingPorts } from '#src/environments/guri/ports';
import { jsonText, sha256 } from '#src/io';
import { CanonicalStateEvidenceSchema, FixtureInitializationSchema } from '#contracts/operational';
export async function saveIndependentEvidence(
  directory: string,
  database: DisposableDatabase,
  before: Awaited<ReturnType<DisposableDatabase['snapshot']>>,
  ports: RecordingPorts,
) {
  const after = await database.snapshot();
  const state = {
    schemaVersion: '2.0.0' as const,
    source: 'independent-postgresql-connection' as const,
    before,
    after,
  };
  CanonicalStateEvidenceSchema.parse(state);
  await writeFile(
    path.join(directory, 'fixture-initialization.json'),
    jsonText(
      FixtureInitializationSchema.parse({
        schemaVersion: '2.0.0',
        database: database.name,
        snapshotHash: sha256(jsonText(before)),
        snapshot: before,
      }),
    ),
    { flag: 'wx' },
  );
  await writeFile(path.join(directory, 'state.json'), jsonText(state), { flag: 'wx' });
  await writeFile(path.join(directory, 'effects.json'), jsonText(ports.effects), { flag: 'wx' });
  await writeFile(path.join(directory, 'port-effects.json'), jsonText(after.portEffects), {
    flag: 'wx',
  });
  await writeFile(
    path.join(directory, 'control-injections.json'),
    jsonText(after.controlInjections),
    { flag: 'wx' },
  );
  return state;
}
