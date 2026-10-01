import { z } from 'zod';
import { Hash, Id, RelativePath } from '#contracts/common';
import { jsonText, sha256 } from '#src/io';
import { readFile } from 'node:fs/promises';
export async function normalizationFingerprint(readerIdentity: string) {
  return sha256(`${readerIdentity}:${sha256(await readFile(new URL(import.meta.url)))}`);
}

export const READER_LIMITS = Object.freeze({
  rawBytes: 8_000_000,
  normalizedBytes: 2_000_000,
  units: 20_000,
  readCharacters: 12_000,
  outputBytes: 1_000_000,
  totalOutputBytes: 4_000_000,
});
export const UnitSchema = z.strictObject({
  locator: z.string().min(1),
  text: z.string(),
  formula: z.string().nullable().optional(),
  cachedValue: z.string().nullable().optional(),
});
export const NormalizedDocumentSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  id: Id,
  path: RelativePath,
  mediaType: z.string(),
  rawHash: Hash,
  parser: z.string().min(1),
  parserHash: Hash,
  extractHash: Hash,
  inputProfile: z.enum(['normalized-text', 'binary-text']),
  units: z.array(UnitSchema),
  gaps: z.array(z.string()),
});
export type EvidenceUnit = z.infer<typeof UnitSchema>;
export type NormalizedDocument = z.infer<typeof NormalizedDocumentSchema>;
export function normalize(
  input: Omit<NormalizedDocument, 'schemaVersion' | 'extractHash'>,
): NormalizedDocument {
  if (input.units.length > READER_LIMITS.units)
    throw new Error('READER_LIMIT: too many evidence units');
  if (new Set(input.units.map((unit) => unit.locator)).size !== input.units.length)
    throw new Error('READER_LOCATOR: duplicate locator');
  const extract = jsonText({ units: input.units, gaps: input.gaps });
  if (Buffer.byteLength(extract) > READER_LIMITS.normalizedBytes)
    throw new Error('READER_LIMIT: normalized extract too large');
  return NormalizedDocumentSchema.parse({
    ...input,
    schemaVersion: '1.0.0',
    extractHash: sha256(extract),
  });
}
export function boundedBytes(bytes: Uint8Array) {
  if (bytes.byteLength > READER_LIMITS.rawBytes) throw new Error('READER_LIMIT: input too large');
}
