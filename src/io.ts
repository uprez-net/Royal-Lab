import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { RelativePath } from '#contracts/common';

export const sha256 = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex');
export const jsonText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}
export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export async function securePath(root: string, relative: string): Promise<string> {
  RelativePath.parse(relative);
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlink forbidden: ${relative}`);
  }
  const canonical = await realpath(current);
  if (!inside(canonicalRoot, canonical)) throw new Error(`Path escapes workspace: ${relative}`);
  return canonical;
}
export async function readScoped(root: string, relative: string): Promise<Buffer> {
  return readFile(await securePath(root, relative));
}
export async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, prefix: string) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden: ${relative}`);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), `${relative}/`);
      else if (entry.isFile()) files.push(relative);
    }
  }
  await visit(root, '');
  return files;
}
