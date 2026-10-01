import { exactFact, jsonPointer } from '#src/grading/facts';
export interface IndependentState {
  source: 'independent-postgresql-connection';
  before: unknown;
  after: unknown;
}
export function verifyState(
  evidence: IndependentState | undefined,
  assertion: {
    collection: string;
    target: Record<string, unknown>;
    fields: Record<string, unknown>;
    count: number;
    historyMinimum?: number;
    preservePaths?: string[];
    operationMinimum?: number;
  },
) {
  if (!evidence || evidence.source !== 'independent-postgresql-connection')
    return { verdict: 'error' as const, reason: 'Independent durable-state evidence is missing' };
  const rows = jsonPointer(evidence.after, `/${assertion.collection}`);
  if (!Array.isArray(rows))
    return { verdict: 'error' as const, reason: 'Expected verifier collection is missing' };
  const matching = rows.filter((row) =>
    Object.entries(assertion.target).every(([key, value]) => exactFact(row?.[key], value)),
  );
  if (
    matching.length !== assertion.count ||
    matching.some((row) =>
      Object.entries(assertion.fields).some(([key, value]) => !exactFact(row?.[key], value)),
    )
  )
    return { verdict: 'fail' as const, reason: 'Durable target/count/fields do not match' };
  for (const [collection, minimum] of [
    ['history', assertion.historyMinimum],
    ['operations', assertion.operationMinimum],
  ] as const) {
    if (minimum !== undefined) {
      const entries = jsonPointer(evidence.after, `/${collection}`);
      if (!Array.isArray(entries) || entries.length < minimum)
        return { verdict: 'fail' as const, reason: `Missing durable ${collection} evidence` };
    }
  }
  for (const pointer of assertion.preservePaths ?? [])
    if (!exactFact(jsonPointer(evidence.before, pointer), jsonPointer(evidence.after, pointer)))
      return { verdict: 'fail' as const, reason: `Protected prior state changed: ${pointer}` };
  return {
    verdict: 'pass' as const,
    reason: 'Independent durable target, history and protected state agree',
  };
}
