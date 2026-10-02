import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { generatedFiles, SPECIMENS } from '#fixtures/generate';
import { sha256 } from '#src/io';
const exec = promisify(execFile);
// Deliberate draft-only upgrade; refuse user edits and retain all policy/source/review bytes.
const upgrades: { relative: string; content: string }[] = [];
for (const [relative, content] of await generatedFiles()) {
  if (!relative.startsWith('tasks/') || !relative.endsWith('/task.json')) continue;
  // Historical 1.1.0 specimen upgrade only; authored 1.2.0 cases are never migrated here.
  if (!SPECIMENS.some((spec) => relative === `tasks/${spec.id}/task.json`)) continue;
  const existing = await readFile(relative, 'utf8');
  if (existing === content) continue;
  const baseline = (await exec('git', ['show', `a6a96bd:${relative}`])).stdout;
  if (sha256(existing) !== sha256(baseline))
    throw new Error(`Refusing edited task upgrade: ${relative}`);
  upgrades.push({ relative, content });
}
for (const upgrade of upgrades) await writeFile(upgrade.relative, upgrade.content);
console.log(
  JSON.stringify({
    taskSchema: '1.1.0',
    taskVersion: '1.1.0',
    upgraded: upgrades.map((item) => item.relative),
    review: 'draft retained',
  }),
);
