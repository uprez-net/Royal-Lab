import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '#src/io';
import { GURI_REVISION } from '#fixtures/generate';
const exec = promisify(execFile);
export async function lockGuriSource(checkout: string) {
  const root = await realpath(checkout);
  const git = async (...args: string[]) =>
    (await exec('git', ['-C', root, ...args], { windowsHide: true })).stdout.trim();
  if ((await git('rev-parse', 'HEAD')) !== GURI_REVISION)
    throw new Error('GURI_REVISION: checkout is not the audited revision');
  if (await git('status', '--porcelain', '--untracked-files=all'))
    throw new Error('GURI_DIRTY: source checkout must be clean');
  const schema = await readFile(path.join(root, 'prisma/schema.prisma'));
  const lock = await readFile(path.join(root, 'pnpm-lock.yaml'));
  const package_ = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  if (package_.dependencies['@prisma/client'] !== '^7.10.0')
    throw new Error('GURI_RUNTIME: unexpected Prisma version');
  return {
    root,
    revision: GURI_REVISION,
    schemaHash: sha256(schema),
    lockfileHash: sha256(lock),
    prismaVersion: '7.10.0',
    dirty: false as const,
  };
}
