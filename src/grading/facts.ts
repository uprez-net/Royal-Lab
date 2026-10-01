import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { sydneyTime } from '#fixtures/clock';
export function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  if (!/^(\/([^~]|~[01])*)*$/.test(pointer)) throw new Error('Invalid JSON pointer');
  let item: unknown = value;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (item === null || typeof item !== 'object' || !Object.hasOwn(item, key))
      throw new Error(`Missing fact: ${pointer}`);
    item = (item as Record<string, unknown>)[key];
  }
  return item;
}
export function exactFact(
  actual: unknown,
  expected: unknown,
  semantics: 'json' | 'cents' | 'identifier' | 'date-only' | 'instant' | 'sydney-date' = 'json',
) {
  if (semantics === 'cents')
    return Number.isSafeInteger(actual) && Number.isSafeInteger(expected) && actual === expected;
  if (semantics === 'identifier') return typeof actual === 'string' && actual === expected;
  if (semantics === 'date-only')
    return z.iso.date().safeParse(actual).success && actual === expected;
  if (semantics === 'instant')
    return (
      z.iso.datetime({ offset: true }).safeParse(actual).success &&
      z.iso.datetime({ offset: true }).safeParse(expected).success &&
      Date.parse(String(actual)) === Date.parse(String(expected))
    );
  if (semantics === 'sydney-date')
    return (
      z.iso.datetime({ offset: true }).safeParse(actual).success &&
      sydneyTime({ instant: String(actual), timezone: 'Australia/Sydney' }).localDate === expected
    );
  return isDeepStrictEqual(actual, expected);
}
export interface ProseAssertion {
  labels: string[];
  expected: number | string | boolean | null;
  semantics: 'cents' | 'integer' | 'identifier' | 'date-only' | 'boolean';
  required: boolean;
}
export function inspectProse(
  text: string,
  assertion: ProseAssertion,
): { verdict: 'pass' | 'fail' | 'unverified'; reason: string } {
  const lines = text
    .split(/\n|(?<=[.!?])\s+(?=[A-Z])/)
    .filter((line) =>
      assertion.labels.some((label) =>
        line.toLocaleLowerCase('en-AU').includes(label.toLocaleLowerCase('en-AU')),
      ),
    );
  if (lines.length === 0)
    return {
      verdict: assertion.required ? 'unverified' : 'pass',
      reason: 'No scoped prose assertion was found',
    };
  let observations = 0;
  for (const line of lines) {
    if (assertion.semantics === 'cents') {
      const matches = [
        ...line.matchAll(
          /(?:AUD\s*)?(-?)\s*\$\s*(-?\d+(?:,\d{3})*(?:\.\d{1,2})?)|AUD\s*(-?\d+(?:,\d{3})*(?:\.\d{1,2})?)/g,
        ),
      ];
      for (const match of matches) {
        observations++;
        const number = match[2] ?? match[3]!;
        if (match[1] === '-' && number.startsWith('-'))
          return { verdict: 'unverified', reason: 'Ambiguous monetary sign' };
        const [whole, fraction = ''] = `${match[1] ?? ''}${number}`.replace(/,/g, '').split('.');
        const cents =
          Number(whole) * 100 +
          (Number(whole) < 0 || whole!.startsWith('-') ? -1 : 1) * Number(fraction.padEnd(2, '0'));
        if (!Number.isSafeInteger(cents) || cents !== assertion.expected)
          return {
            verdict: 'fail',
            reason: 'Client-facing amount contradicts the frozen expected fact',
          };
      }
    } else if (assertion.semantics === 'integer') {
      for (const match of line.matchAll(/\b\d+\b/g)) {
        observations++;
        if (!Number.isSafeInteger(Number(match[0])) || Number(match[0]) !== assertion.expected)
          return {
            verdict: 'fail',
            reason: 'Client-facing count contradicts the frozen expected fact',
          };
      }
    } else if (assertion.semantics === 'date-only') {
      for (const date of line.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []) {
        observations++;
        if (date !== assertion.expected)
          return {
            verdict: 'fail',
            reason: 'Client-facing date contradicts the frozen expected fact',
          };
      }
    } else if (assertion.semantics === 'identifier') {
      const expected = String(assertion.expected);
      if (!line.includes(expected))
        return {
          verdict: 'fail',
          reason: 'Client-facing identity lacks the exact scoped expected identifier',
        };
      observations++;
    } else {
      const positive = [
        ...line.matchAll(
          /\b(verified|paid|sent|approved|completed|raised|synchronized|overdue|included|true)\b/gi,
        ),
      ];
      const negative = /\b(not|no|unverified|unpaid|unsent|unknown|cancelled|excluded)\b/i.test(
        line,
      );
      if (positive.length === 0 && !negative) continue;
      observations++;
      const affirmed = positive.filter(
        (match) =>
          !/\b(not|no|never)\b/i.test(
            line
              .slice(0, match.index)
              .split(/\b(?:but|however|and)\b|[;:]/i)
              .at(-1)!
              .split(/\s+/)
              .slice(-5)
              .join(' '),
          ),
      );
      if (
        (assertion.expected === false && affirmed.length > 0) ||
        (assertion.expected === true && (affirmed.length === 0 || negative))
      )
        return { verdict: 'fail', reason: 'Client-facing claim asserts an unverified completion' };
    }
  }
  return {
    verdict: observations ? 'pass' : 'unverified',
    reason: observations
      ? 'Scoped prose facts agree'
      : 'No parseable scoped prose fact; explicit verification is required',
  };
}
export function citationReferences(text: string, sources: { id: string; locators: string[] }[]) {
  const references = [...text.matchAll(/\[([a-zA-Z0-9._-]+)\s+([^\]\n]+)\]/g)].map((match) => ({
    sourceId: match[1]!,
    locator: match[2]!.trim(),
  }));
  const invalid = references.filter(
    (reference) =>
      !sources.some(
        (source) => source.id === reference.sourceId && source.locators.includes(reference.locator),
      ),
  );
  return { references, invalid, valid: references.length > 0 && invalid.length === 0 };
}
