import { EveDurableEvidenceSchema, type EveDurableEvidence } from '#contracts/eve';
import { sha256 } from '#src/io';

// Import the separate fixture maintainer's `eve:eval:fixtures verify` report.
// The maintainer holds the staging database credential; the evaluator does not.
// The report is the product's own human-readable output at the pinned revision,
// parsed strictly: an unrecognized line is an import error, never ignored.
export function importFixtureVerify(
  raw: string,
  meta: {
    productRevision: string;
    producedAt: string;
    databaseLabel: string;
    fixtureVersion: string;
    exitCode: number;
    now?: () => Date;
  },
): EveDurableEvidence {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let section: 'tasks' | 'operations' | 'audits' | null = null;
  let windowHours: number | null = null;
  const evidence = {
    leadTasks: [] as EveDurableEvidence['leadTasks'],
    operations: [] as EveDurableEvidence['operations'],
    audits: [] as EveDurableEvidence['audits'],
  };
  const declared: Record<string, number> = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    let match: RegExpMatchArray | null;
    if ((match = line.match(/^Last (\d+)h for \S+:$/))) {
      windowHours = Number(match[1]);
      continue;
    }
    if ((match = line.match(/^Marked lead tasks \((\d+)\):$/))) {
      section = 'tasks';
      declared.tasks = Number(match[1]);
      continue;
    }
    if ((match = line.match(/^Agent operations \((\d+)\):$/))) {
      section = 'operations';
      declared.operations = Number(match[1]);
      continue;
    }
    if ((match = line.match(/^Audit rows \((\d+)\):$/))) {
      section = 'audits';
      declared.audits = Number(match[1]);
      continue;
    }
    // ✓/✗, or their UTF-8-as-CP437 mojibake from a Windows console (Γ£ô/Γ£ù).
    if (/^(?:[✓✗]|Γ£[ôù]) /.test(line)) {
      section = null;
      continue;
    }
    if (
      section === 'tasks' &&
      (match = line.match(/^ {2}#(\S+) lead=".*" status=(\S+) completedAt=(\S+) notes=(.*)$/))
    ) {
      evidence.leadTasks.push({
        id: match[1]!,
        status: match[2]!,
        completedAt: match[3] === '—' ? null : match[3]!,
        notes: String(JSON.parse(match[4]!)),
      });
      continue;
    }
    if (section === 'operations' && (match = line.match(/^ {2}(\S+)\s+(\S+)\s+(\S+)$/))) {
      evidence.operations.push({ status: match[1]!, action: match[2]!, operationKey: match[3]! });
      continue;
    }
    if (
      section === 'audits' &&
      (match = line.match(/^ {2}(\S+)\s+(\S+)\s+approval=(\S+) target=(\S+)$/))
    ) {
      evidence.audits.push({
        status: match[1]!,
        toolName: match[2]!,
        approval: match[3] === '—' ? null : match[3]!,
        target: match[4] === '—:—' ? null : match[4]!,
      });
      continue;
    }
    throw new Error(`EVE_VERIFY_UNRECOGNIZED_LINE: ${JSON.stringify(line.slice(0, 120))}`);
  }
  if (windowHours === null) throw new Error('EVE_VERIFY_HEADER_MISSING');
  if (
    declared.tasks !== evidence.leadTasks.length ||
    declared.operations !== evidence.operations.length ||
    declared.audits !== evidence.audits.length
  )
    throw new Error('EVE_VERIFY_COUNT_MISMATCH');
  return EveDurableEvidenceSchema.parse({
    schemaVersion: '1.0.0',
    source: 'eve-eval-fixtures verify',
    productRevision: meta.productRevision,
    operatorRole: 'fixture-maintainer',
    producedAt: meta.producedAt,
    importedAt: (meta.now ?? (() => new Date()))().toISOString(),
    databaseLabel: meta.databaseLabel,
    fixtureVersion: meta.fixtureVersion,
    windowHours,
    exitCode: meta.exitCode,
    rawHash: sha256(raw),
    ...evidence,
  });
}
