import type { Json } from '#fixtures/authoring/types';

// Formatting helpers for authoring original synthetic material only.
export function aud(cents: number) {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${dollars}.${String(absolute % 100).padStart(2, '0')}`;
}
export const json = (value: Json) => `${JSON.stringify(value, null, 2)}\n`;
export const lines = (...items: string[]) => `${items.join('\n')}\n`;
// Plain-text RFC 822 message. Bodies are 7-bit text so normalized body lines
// stay aligned with the authored lines.
export function email(headers: Record<string, string>, body: string[]) {
  return `${Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join(
      '\r\n',
    )}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body.join('\r\n')}\r\n`;
}
export const keyFigures = (rows: [string, string][]) =>
  ['## Key figures', '', ...rows.map(([label, value]) => `- ${label}: ${value}`)].join('\n');
export const DOCUMENT_REPORT_RULES =
  'Cite every consequential fact as [source-id locator] using locators from the read/search tools. End review.md with a "## Key figures" section containing one line per listed label, written exactly as `Label: value`.';
