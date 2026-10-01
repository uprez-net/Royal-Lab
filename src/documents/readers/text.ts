import { parse } from 'csv-parse/sync';
import PostalMime from 'postal-mime';
import { readFile } from 'node:fs/promises';
import { sha256 } from '#src/io';
import { boundedBytes, type EvidenceUnit } from '#src/documents/normalize';

export const TEXT_PARSER = 'royal-text-1.0.0/csv-parse-7.0.3/postal-mime-4.0.2';
export async function textReaderFingerprint() {
  return `${TEXT_PARSER}:${sha256(await readFile(new URL(import.meta.url)))}`;
}
export async function readText(
  bytes: Uint8Array,
  mediaType: string,
): Promise<{ units: EvidenceUnit[]; gaps: string[] }> {
  boundedBytes(bytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n');
  if (mediaType === 'application/json') {
    const value: unknown = JSON.parse(text);
    const units: EvidenceUnit[] = [];
    const visit = (item: unknown, pointer: string) => {
      if (item !== null && typeof item === 'object' && Object.keys(item).length > 0)
        for (const [key, child] of Object.entries(item))
          visit(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      else units.push({ locator: `json:${pointer || '/'}`, text: JSON.stringify(item) });
    };
    visit(value, '');
    return { units, gaps: [] };
  }
  if (mediaType === 'text/csv') {
    const rows: string[][] = parse(text, {
      bom: true,
      max_record_size: 100_000,
      relax_column_count: false,
    });
    return {
      units: rows.map((row, index) => ({ locator: `row:${index + 1}`, text: JSON.stringify(row) })),
      gaps: [],
    };
  }
  if (mediaType === 'message/rfc822') {
    const mail = await PostalMime.parse(bytes);
    const units = mail.headers.map((header, index) => ({
      locator: `header:${index + 1}:${header.key}`,
      text: header.value,
    }));
    const gaps: string[] = [];
    if (!mail.text) gaps.push('No plain-text body. HTML/vision interpretation is not enabled.');
    for (const [index, line] of (mail.text ?? '').replace(/\r\n?/g, '\n').split('\n').entries())
      units.push({ locator: `body:line:${index + 1}`, text: line });
    for (const [index, attachment] of mail.attachments.entries()) {
      units.push({
        locator: `attachment:${index + 1}`,
        text: `${attachment.filename ?? '(unnamed)'} / ${attachment.mimeType}`,
      });
      gaps.push(
        `Attachment ${index + 1} is not recursively extracted; supply it as a separately allowlisted source.`,
      );
    }
    return { units, gaps };
  }
  if (!['text/plain', 'text/markdown'].includes(mediaType))
    throw new Error(`READER_UNSUPPORTED: ${mediaType}`);
  return {
    units: text.split('\n').map((line, index) => ({ locator: `line:${index + 1}`, text: line })),
    gaps: [],
  };
}
