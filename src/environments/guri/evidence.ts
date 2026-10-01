import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DisposableDatabase } from '#src/environments/guri/database';
import type { RecordingPorts } from '#src/environments/guri/ports';
import { jsonText, sha256 } from '#src/io';
export async function saveIndependentEvidence(
  directory: string,
  database: DisposableDatabase,
  before: Awaited<ReturnType<DisposableDatabase['snapshot']>>,
  ports: RecordingPorts,
) {
  const after = await database.snapshot();
  const state = { source: 'independent-postgresql-connection' as const, before, after };
  await writeFile(
    path.join(directory, 'fixture-initialization.json'),
    jsonText({
      schemaVersion: '1.0.0',
      database: database.name,
      snapshotHash: sha256(jsonText(before)),
      snapshot: before,
    }),
    { flag: 'wx' },
  );
  await writeFile(path.join(directory, 'state.json'), jsonText(state), { flag: 'wx' });
  await writeFile(path.join(directory, 'effects.json'), jsonText(ports.effects), { flag: 'wx' });
  return state;
}
