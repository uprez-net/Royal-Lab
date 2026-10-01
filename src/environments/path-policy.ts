import { mkdir, lstat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { RelativePath } from '#contracts/common';
import { inside } from '#src/io';

export async function writeOutput(
  root: string,
  relative: string,
  bytes: string,
  allowed: Set<string>,
) {
  RelativePath.parse(relative);
  if (!allowed.has(relative)) throw new Error('OUTPUT_DENIED: undeclared deliverable');
  const base = await realpath(root);
  const parts = relative.split('/');
  let directory = base;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    await mkdir(directory, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory() || !inside(base, await realpath(directory)))
      throw new Error('OUTPUT_DENIED: unsafe directory');
  }
  const target = path.join(directory, parts.at(-1)!);
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('OUTPUT_DENIED: unsafe target');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // The dedicated workspace is controller-owned; candidates have no host filesystem capability.
  const file = await open(target, 'w', 0o600);
  try {
    await file.writeFile(bytes, 'utf8');
  } finally {
    await file.close();
  }
}
