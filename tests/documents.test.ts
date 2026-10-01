import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '#src/documents/readers/text';
import { normalize, READER_LIMITS } from '#src/documents/normalize';
import { parserDockerArguments } from '#src/documents/readers/binary';
import { DocumentWorkspace } from '#src/environments/documents';
import { discover } from '#tasks/discover';
import { sha256 } from '#src/io';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function workspace() {
  await mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const directory = await mkdtemp(path.join(ROOT, 'tmp/document-'));
  directories.push(directory);
  const task = (await discover(ROOT)).find((entry) => entry.task.definitionId === 'D01')!.task;
  return {
    directory,
    task,
    workspace: await DocumentWorkspace.create(ROOT, task, path.join(directory, 'outputs')),
  };
}
test('long evidence units are fully reachable through a bounded cursor and inherited tool names are denied', async () => {
  await mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const directory = await mkdtemp(path.join(ROOT, 'tmp/read-cursor-'));
  directories.push(directory);
  const task = structuredClone(
    (await discover(ROOT)).find((entry) => entry.task.definitionId === 'D01')!.task,
  );
  const bytes = JSON.stringify({ large: 'x'.repeat(32000) });
  const docDirectory = path.join(directory, `tasks/${task.id}/documents`);
  await mkdir(docDirectory, { recursive: true });
  await writeFile(path.join(docDirectory, 'source.json'), bytes);
  task.inputs = [
    {
      id: 'source',
      path: 'documents/source.json',
      kind: 'document',
      mediaType: 'application/json',
      sha256: sha256(bytes),
    },
  ];
  const docs = await DocumentWorkspace.create(directory, task, path.join(directory, 'outputs'));
  let cursor: { start: number; offset: number } | null = { start: 0, offset: 0 };
  let collected = '';
  let reads = 0;
  while (cursor) {
    const result = (await docs.execute('read', { path: 'documents/source.json', ...cursor })) as {
      units: { text: string }[];
      nextCursor: { start: number; offset: number } | null;
    };
    const text = result.units.map((unit) => unit.text).join('');
    assert.ok(text.length <= READER_LIMITS.readCharacters);
    collected += text;
    cursor = result.nextCursor;
    assert.ok(++reads <= 3);
  }
  assert.equal(collected, docs.snapshot()[0]!.units[0]!.text);
  await assert.rejects(docs.execute('constructor', {}), /TOOL_UNKNOWN/);
});
test('stable JSON pointers and CSV logical rows survive escaping and embedded newlines', async () => {
  const json = await readText(Buffer.from('{"a/b":{"~value":123}}'), 'application/json');
  assert.equal(json.units[0]!.locator, 'json:/a~1b/~0value');
  const csv = await readText(Buffer.from('Name,Note\r\nFiction,"first\nsecond"\r\n'), 'text/csv');
  assert.equal(csv.units[1]!.locator, 'row:2');
  assert.ok(csv.units[1]!.text.includes('first\\nsecond'));
  await assert.rejects(readText(Buffer.from('a,b\nonly'), 'text/csv'));
  await assert.rejects(readText(Buffer.from([255]), 'text/plain'));
});
test('EML retains headers/body references and exposes unextracted HTML explicitly', async () => {
  const mail = await readText(
    Buffer.from('From: owner@builder.example\r\nContent-Type: text/plain\r\n\r\nPlease follow up.'),
    'message/rfc822',
  );
  assert.ok(
    mail.units.some((unit) => unit.locator === 'body:line:1' && unit.text.includes('follow up')),
  );
  const html = await readText(
    Buffer.from('Content-Type: text/html\r\n\r\n<b>approval</b>'),
    'message/rfc822',
  );
  assert.ok(html.gaps.some((gap) => gap.includes('plain-text')));
});
test('closed workspace exposes only allowed evidence and declared outputs', async () => {
  const { workspace, task } = await workspaceFixture();
  const inventory = (await workspace.execute('list', {})) as { path: string }[];
  assert.deepEqual(
    inventory.map((file) => file.path),
    task.inputs.map((file) => file.path),
  );
  const read = (await workspace.execute('read', { path: 'documents/source.json' })) as {
    units: unknown[];
  };
  assert.ok(read.units.length > 0);
  const search = (await workspace.execute('search', { query: 'Cedar' })) as { matches: unknown[] };
  assert.ok(search.matches.length > 0);
  for (const file of ['grading/fixture.json', '../.env', 'provenance.json', 'C:/secret'])
    await assert.rejects(workspace.execute('read', { path: file }));
  await assert.rejects(workspace.execute('write', { path: 'other.md', content: 'bad' }));
  await assert.rejects(
    workspace.execute('write', {
      path: 'facts.json',
      content: 'x'.repeat(READER_LIMITS.outputBytes + 1),
    }),
  );
  await assert.rejects(workspace.artifacts(), /OUTPUT_MISSING/);
  await workspace.execute('write', { path: 'facts.json', content: '{"contractCents":66457600}' });
  await workspace.execute('write', {
    path: 'review.md',
    content: 'source json:/quote/contractCents: quoted AUD $664,576.',
  });
  assert.equal((await workspace.artifacts()).length, 2);
});
const workspaceFixture = workspace;
test('output symlink cannot redirect a declared deliverable', async () => {
  const { directory, workspace } = await workspaceFixture();
  const outside = path.join(directory, 'protected');
  await mkdir(outside);
  await symlink(outside, path.join(directory, 'outputs/facts.json'), 'junction');
  await assert.rejects(
    workspace.execute('write', { path: 'facts.json', content: '{}' }),
    /unsafe target/,
  );
});
test('binary parser command has no mounts, credentials or network and requires immutable image', () => {
  const args = parserDockerArguments(
    { image: 'royal-lab-parser:1.0.0', imageId: `sha256:${'a'.repeat(64)}` },
    'royal-test',
  );
  for (const argument of [
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--memory=256m',
  ])
    assert.ok(args.includes(argument));
  assert.ok(!args.some((arg) => arg === '-v' || arg === '--mount' || arg === '-e'));
  assert.throws(
    () => parserDockerArguments({ image: 'latest', imageId: 'latest' }, 'royal-test'),
    /UNPINNED/,
  );
});
test('normalization freezes exact extracts and rejects unbounded or duplicate references', () => {
  const data = {
    id: 'source',
    path: 'documents/a.txt',
    mediaType: 'text/plain',
    rawHash: sha256('x'),
    parser: 'text-1',
    parserHash: sha256('text-1'),
    inputProfile: 'normalized-text' as const,
    units: [{ locator: 'line:1', text: 'x' }],
    gaps: [],
  };
  assert.equal(normalize(data).extractHash, normalize(data).extractHash);
  assert.throws(() => normalize({ ...data, units: [data.units[0]!, data.units[0]!] }), /duplicate/);
});
