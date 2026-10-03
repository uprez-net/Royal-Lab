import { open, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { ProfileId } from '#contracts/common';
import type { PlannedTrial } from '#contracts/experiment';
import type { z } from 'zod';

// Deterministic seeded order: SHA-256 counter stream, no Math.random.
export function seededPermutation<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  let counter = 0;
  const next = () => {
    const digest = createHash('sha256').update(`${seed}:${counter++}`).digest();
    return digest.readUInt32BE(0) / 2 ** 32;
  };
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

// Shared resources are serialized. Documents trials use independent workspaces;
// fixed-tools trials each get their own run database but share the bridge build;
// Royal Eve staging is a single shared deployment and additionally needs an
// external lock so two machines cannot write to it at once.
export function trialResources(profile: z.infer<typeof ProfileId>): string[] {
  if (profile === 'royal-eve') return ['royal-eve-staging'];
  if (profile === 'fixed-tools') return ['guri-bridge-provisioning'];
  return [];
}

// Plan order: repeats outer, then cases, then configurations in a seeded order
// per (case, repeat) block. Task fixtures, clock and tools are identical across a block.
export function planTrials(
  cases: string[],
  configurationIds: string[],
  repeats: number,
  seed: string,
  profile: z.infer<typeof ProfileId>,
  newId: () => string = () => `trial-${randomUUID()}`,
): PlannedTrial[] {
  const trials: PlannedTrial[] = [];
  let block = 0;
  for (let repeat = 0; repeat < repeats; repeat++)
    for (const taskId of cases) {
      const order = seededPermutation(configurationIds, `${seed}|${taskId}|${repeat}`);
      order.forEach((configurationId, orderInBlock) =>
        trials.push({
          trialId: newId(),
          sequence: trials.length,
          taskId,
          configurationId,
          repeat,
          block,
          orderInBlock,
          resources: trialResources(profile),
        }),
      );
      block++;
    }
  return trials;
}

export class ResourceLocks {
  private readonly tails = new Map<string, Promise<void>>();
  async acquire(keys: string[]): Promise<() => void> {
    const sorted = [...new Set(keys)].sort();
    const releases: (() => void)[] = [];
    for (const key of sorted) {
      const previous = this.tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => (release = resolve));
      this.tails.set(
        key,
        previous.then(() => current),
      );
      await previous;
      releases.push(release);
    }
    return () => releases.reverse().forEach((release) => release());
  }
}

// Exclusive cross-process lock file (O_EXCL). A stale lock is never broken
// automatically: an operator must confirm the other run has stopped.
export async function externalLock(file: string, owner: string) {
  const handle = await open(file, 'wx').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST')
      throw new Error(`EXTERNAL_LOCK_HELD: ${file}; confirm the other run stopped before removal`);
    throw error;
  });
  await handle.writeFile(JSON.stringify({ owner, pid: process.pid, at: new Date().toISOString() }));
  await handle.close();
  return async () => rm(file, { force: true });
}

export interface ScheduleOptions {
  concurrency: number;
  // Return false to stop scheduling further trials (budget/wall-clock).
  admit: (trial: PlannedTrial) => Promise<boolean> | boolean;
  run: (trial: PlannedTrial) => Promise<void>;
}
// Bounded concurrency in plan order. Admission happens in order and is serial,
// so a budget decision always sees every earlier reservation.
export async function schedule(trials: PlannedTrial[], options: ScheduleOptions) {
  const locks = new ResourceLocks();
  const running = new Set<Promise<void>>();
  let admission: Promise<unknown> = Promise.resolve();
  let stopped = false;
  const errors: unknown[] = [];
  for (const trial of trials) {
    if (stopped) break;
    while (running.size >= options.concurrency) await Promise.race(running);
    let admitted = false;
    admission = admission.then(async () => {
      admitted = !stopped && (await options.admit(trial));
      if (!admitted) stopped = true;
    });
    await admission;
    if (!admitted) break;
    const task = (async () => {
      const release = await locks.acquire(trial.resources);
      try {
        await options.run(trial);
      } catch (error) {
        errors.push(error);
      } finally {
        release();
      }
    })();
    running.add(task);
    void task.finally(() => running.delete(task));
  }
  await Promise.all(running);
  return { stopped, errors };
}
