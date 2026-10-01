import path from 'node:path';
import { TaskSchema, type Task } from '#contracts/task';
import { readScoped, walk } from '#src/io';

export interface DiscoveredTask { directory: string; task: Task }
export async function discover(root: string): Promise<DiscoveredTask[]> {
  const tasksRoot = path.join(root, 'tasks');
  const files = (await walk(tasksRoot)).filter((p) => p.endsWith('/task.json'));
  const tasks: DiscoveredTask[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const task = TaskSchema.parse(JSON.parse((await readScoped(tasksRoot, file)).toString('utf8')));
    const directory = file.slice(0, -'/task.json'.length);
    if (task.id !== directory) throw new Error(`Task ID/path mismatch: ${file}`);
    if (task.family !== directory.split('/')[0]) throw new Error(`Task family/path mismatch: ${file}`);
    if (seen.has(task.id)) throw new Error(`Duplicate task ID: ${task.id}`);
    seen.add(task.id); tasks.push({ directory, task });
  }
  return tasks;
}
