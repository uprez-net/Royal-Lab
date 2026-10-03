import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ExperimentPlanSchema,
  LedgerEventSchema,
  TrialBundleReceiptSchema,
  type ExperimentPlan,
  type LedgerEvent,
} from '#contracts/experiment';
import { jsonText, readScoped, securePath, sha256, walk } from '#src/io';
import { stableJson } from '#src/environments/session';

// Experiment directory layout (ignored by Git under results/):
//   plan.json            frozen plan, written once
//   ledger.jsonl         append-only, hash-chained trial events
//   trials/<trialId>/    write-once trial bundle + bundle-receipt.json
export const experimentDirectory = (root: string, experimentId: string) =>
  path.join(root, 'results', 'experiments', experimentId);

type Draft<T> = T extends unknown
  ? Omit<T, 'schemaVersion' | 'sequence' | 'at' | 'previousHash' | 'hash' | 'experimentId'>
  : never;
export type LedgerDraft = Draft<LedgerEvent>;

export class ExperimentLedger {
  private constructor(
    readonly directory: string,
    readonly plan: ExperimentPlan,
    private events: LedgerEvent[],
    private readonly clock: () => string,
  ) {}
  static async create(
    directory: string,
    plan: ExperimentPlan,
    clock = () => new Date().toISOString(),
  ) {
    await mkdir(path.join(directory, 'trials'), { recursive: true });
    await writeFile(path.join(directory, 'plan.json'), jsonText(ExperimentPlanSchema.parse(plan)), {
      flag: 'wx',
    });
    await writeFile(path.join(directory, 'ledger.jsonl'), '', { flag: 'wx' });
    const ledger = new ExperimentLedger(directory, plan, [], clock);
    await ledger.append({ type: 'plan-frozen', planHash: plan.planHash });
    return ledger;
  }
  static async open(directory: string, clock = () => new Date().toISOString()) {
    const plan = ExperimentPlanSchema.parse(
      JSON.parse((await readScoped(directory, 'plan.json')).toString('utf8')),
    );
    const { planHash, ...unsigned } = plan;
    if (sha256(stableJson(unsigned)) !== planHash) throw new Error('EXPERIMENT_PLAN_CHANGED');
    const events = verifyLedger(
      (await readScoped(directory, 'ledger.jsonl')).toString('utf8'),
      plan,
    );
    return new ExperimentLedger(directory, plan, events, clock);
  }
  get all(): readonly LedgerEvent[] {
    return this.events;
  }
  private writes: Promise<unknown> = Promise.resolve();
  // Serialized so concurrent trials cannot interleave the hash chain.
  append(draft: LedgerDraft): Promise<LedgerEvent> {
    const next = this.writes.then(async () => {
      const previous = this.events.at(-1) ?? null;
      const unsigned = {
        schemaVersion: '1.0.0' as const,
        experimentId: this.plan.experimentId,
        sequence: this.events.length,
        at: this.clock(),
        previousHash: previous?.hash ?? null,
        ...draft,
      };
      const event = LedgerEventSchema.parse({ ...unsigned, hash: sha256(stableJson(unsigned)) });
      await appendFile(path.join(this.directory, 'ledger.jsonl'), `${JSON.stringify(event)}\n`);
      this.events.push(event);
      return event;
    });
    this.writes = next.catch(() => {});
    return next;
  }
  trialDirectory(trialId: string) {
    return path.join(this.directory, 'trials', trialId);
  }
}

export function verifyLedger(text: string, plan: ExperimentPlan): LedgerEvent[] {
  const lines = text.split('\n').filter((line) => line.length > 0);
  const events = lines.map((line) => LedgerEventSchema.parse(JSON.parse(line)));
  let previous: string | null = null;
  events.forEach((event, index) => {
    const { hash, ...unsigned } = event;
    if (
      event.sequence !== index ||
      event.experimentId !== plan.experimentId ||
      event.previousHash !== previous ||
      sha256(stableJson(unsigned)) !== hash
    )
      throw new Error(`EXPERIMENT_LEDGER_TAMPERED: event ${index}`);
    previous = hash;
  });
  if (events[0]?.type !== 'plan-frozen' || events[0].planHash !== plan.planHash)
    throw new Error('EXPERIMENT_LEDGER_PLAN_MISMATCH');
  const finished = new Set<string>();
  const started = new Set<string>();
  for (const event of events) {
    if (event.type === 'trial-started') {
      if (started.has(event.trialId)) throw new Error(`TRIAL_STARTED_TWICE: ${event.trialId}`);
      started.add(event.trialId);
    }
    if (event.type === 'trial-finished') {
      if (finished.has(event.trialId)) throw new Error(`TRIAL_FINISHED_TWICE: ${event.trialId}`);
      finished.add(event.trialId);
    }
  }
  return events;
}

// Seal a trial bundle: hash every file once the trial has finished. Any later
// change to the bundle is detected by verifyBundle; grade files are added as
// new files and recorded in the ledger, never by rewriting sealed files.
export async function sealBundle(directory: string, experimentId: string, trialId: string) {
  const files = (await walk(directory)).filter((file) => file !== 'bundle-receipt.json').sort();
  const receipt = TrialBundleReceiptSchema.parse({
    schemaVersion: '1.0.0',
    experimentId,
    trialId,
    files: await Promise.all(
      files.map(async (file) => ({
        path: file,
        sha256: sha256(await readScoped(directory, file)),
      })),
    ),
  });
  const text = jsonText(receipt);
  await writeFile(path.join(directory, 'bundle-receipt.json'), text, { flag: 'wx' });
  return sha256(text);
}
export async function verifyBundle(directory: string, expectedHash: string) {
  const bytes = await readScoped(directory, 'bundle-receipt.json');
  if (sha256(bytes) !== expectedHash) throw new Error('TRIAL_BUNDLE_RECEIPT_CHANGED');
  const receipt = TrialBundleReceiptSchema.parse(JSON.parse(bytes.toString('utf8')));
  for (const file of receipt.files)
    if (sha256(await readFile(await securePath(directory, file.path))) !== file.sha256)
      throw new Error(`TRIAL_BUNDLE_CHANGED: ${file.path}`);
  return receipt;
}
