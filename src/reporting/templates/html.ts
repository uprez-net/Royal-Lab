// Minimal static review page. Every interpolated value passes through `escape`;
// links are restricted to relative bundle paths. The page carries a CSP that
// forbids scripts, remote loads, forms and frames.
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};
export function escape(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.replace(/[&<>"'`]/g, (character) => ENTITIES[character]!);
}
// Only simple relative paths into the experiment directory become links.
export function safeHref(href: string | null): string | null {
  if (!href) return null;
  if (!/^\.?\/?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(href)) return null;
  if (href.split('/').some((part) => part === '..')) return null;
  return href;
}
export const link = (href: string | null, text: string) => {
  const safe = safeHref(href);
  return safe ? `<a href="${escape(safe)}">${escape(text)}</a>` : escape(text);
};
export const table = (headers: string[], rows: string[][]) =>
  `<table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
export function page(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'">
<meta name="referrer" content="no-referrer">
<title>${escape(title)}</title>
<style>
:root { color-scheme: light dark; --fg: #1d232b; --bg: #fbfaf7; --muted: #5b6672; --line: #d9d6cf; --bad: #a3271f; --good: #1f6b3a; --warn: #8a5a00; }
@media (prefers-color-scheme: dark) { :root { --fg: #e7e4dc; --bg: #16191d; --muted: #9aa3ad; --line: #343a42; --bad: #ff8a80; --good: #7fd19b; --warn: #f2c14e; } }
body { font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0 auto; max-width: 1200px; padding: 16px; }
h1, h2, h3 { line-height: 1.2; } h1 { font-size: 1.5rem; } h2 { font-size: 1.2rem; margin-top: 2rem; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; font-size: .9rem; display: block; overflow-x: auto; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
.muted { color: var(--muted); } .fail { color: var(--bad); font-weight: 600; } .pass { color: var(--good); } .warn { color: var(--warn); }
details { border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; margin: 6px 0; }
summary { cursor: pointer; } code { font-size: .85rem; word-break: break-all; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
