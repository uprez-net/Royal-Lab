import { readScoped, sha256 } from '#src/io';
import { validateTask } from '#tasks/validate';
import type { Task } from '#contracts/task';

export async function visibleInput(root: string, task: Task) {
  const { directory } = await validateTask(root, task);
  // Construct a new allowlisted object. Never spread a task, rubric or fixture.
  const files = [];
  for (const input of task.inputs) {
    const bytes = await readScoped(directory, input.path);
    if (sha256(bytes) !== input.sha256) throw new Error(`Input changed during projection: ${input.path}`);
    if (!['text/markdown', 'text/plain', 'application/json', 'text/csv'].includes(input.mediaType)) throw new Error('Binary readers belong to issue #6');
    files.push({ id: input.id, path: input.path, mediaType: input.mediaType, content: bytes.toString('utf8') });
  }
  return { id: task.id, title: task.title, instruction: task.instruction,
    clock: task.clock, jurisdiction: task.jurisdiction, currency: task.currency,
    tools: task.tools, deliverables: task.deliverables, limits: task.limits, files };
}
