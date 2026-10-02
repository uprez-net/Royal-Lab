import { mkdir, copyFile } from 'node:fs/promises';
await mkdir(new URL('../dist/harness/prompts/', import.meta.url), { recursive: true });
for (const profile of ['documents', 'fixed-tools'])
  await copyFile(
    new URL(`../src/harness/prompts/${profile}.txt`, import.meta.url),
    new URL(`../dist/harness/prompts/${profile}.txt`, import.meta.url),
  );
await mkdir(new URL('../dist/grading/prompts/', import.meta.url), { recursive: true });
await copyFile(
  new URL('../src/grading/prompts/criterion.txt', import.meta.url),
  new URL('../dist/grading/prompts/criterion.txt', import.meta.url),
);
