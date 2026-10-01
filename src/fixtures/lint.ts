import path from 'node:path';
import { readScoped, walk } from '#src/io';
import { WorldSchema } from '#fixtures/world';

export interface Finding { file: string; rule: string; message: string }
export function scanText(text: string): string[] {
  const findings: string[] = [];
  if (/\b(?:sk[-_][A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/.test(text)) findings.push('secret-pattern');
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  if (emails.some((email) => !email.endsWith('.example'))) findings.push('non-synthetic-email');
  if (/\b(?:ABN|TFN|licen[cs]e)\s*[:#]?\s*(?:\d[ -]*){8,11}\b/i.test(text)) findings.push('sensitive-identifier');
  if (/\b(?:postgres(?:ql)?:\/\/|Bearer\s+[A-Za-z0-9_-]{16,})/i.test(text)) findings.push('credential-connection');
  return findings;
}
export function lintWorld(value: unknown): string[] {
  const world = WorldSchema.parse(value); const findings: string[] = [];
  const ids = new Set(world.entities.map((e) => e.id));
  if (ids.size !== world.entities.length) findings.push('duplicate-entity');
  for (const entity of world.entities) for (const ref of entity.references) if (!ids.has(ref)) findings.push(`unknown-reference:${ref}`);
  for (const evidence of world.evidence) if (!ids.has(evidence.entityId)) findings.push(`unknown-evidence-entity:${evidence.entityId}`);
  for (const item of world.ambiguity) if (item.entityIds.some((id) => !ids.has(id))) findings.push('unknown-ambiguity-entity');
  for (const conflict of world.versionConflicts) {
    if (!ids.has(conflict.entityId) || conflict.currentVersion <= conflict.readVersion) findings.push('invalid-version-conflict');
  }
  if (world.facts.paidCents > world.facts.invoiceCents) findings.push('payment-exceeds-invoice');
  return findings;
}
export async function lint(root: string) {
  const findings: Finding[] = [];
  for (const directory of ['fixtures', 'tasks']) {
    for (const relative of await walk(path.join(root, directory))) {
      const file = `${directory}/${relative}`;
      const text = (await readScoped(root, file)).toString('utf8');
      for (const rule of scanText(text)) findings.push({ file, rule, message: 'Review synthetic-data/privacy violation; value withheld.' });
      if (file.startsWith('fixtures/worlds/') && file.endsWith('.json')) {
        for (const rule of lintWorld(JSON.parse(text))) findings.push({ file, rule, message: 'Inconsistent fictional world' });
      }
    }
  }
  return { valid: findings.length === 0, findings,
    limitation: 'Pattern lint cannot prove anonymity, copyright ownership, OCR fidelity or business correctness. Human review remains required.' };
}
