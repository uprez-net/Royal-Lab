// Static review page. Every interpolated value passes through `escape`; links are
// restricted to relative bundle paths. The page carries a CSP that forbids
// scripts, remote loads, forms and frames, so charts are plain HTML/CSS and hover
// details use native `<title>`/`title` tooltips.
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
// Fixed-layout table that wraps instead of scrolling sideways.
export const table = (headers: string[], rows: string[][]) =>
  `<table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;

// Categorical slots for configurations (identity, validated on the dark surface
// #1a1a19: band, chroma, CVD and contrast all pass). Assigned by the plan's
// configuration order, never by rank, so a configuration keeps its colour.
export const SERIES = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];
// Status colours mean state only and always travel with an icon and a label.
export const STATUS = {
  pass: { color: '#0ca30c', icon: '✓', label: 'pass' },
  fail: { color: '#d03b3b', icon: '✗', label: 'fail' },
  error: { color: '#fab219', icon: '!', label: 'error' },
  ungraded: { color: '#6b6a65', icon: '–', label: 'ungraded' },
} as const;
export type StatusKey = keyof typeof STATUS;

export const pill = (status: StatusKey, label: string = STATUS[status].label) =>
  `<span class="pill"><i style="background:${STATUS[status].color}">${STATUS[status].icon}</i>${escape(label)}</span>`;
export const swatch = (color: string) => `<i class="dot" style="background:${color}"></i>`;
export const tile = (label: string, value: string, note = '') =>
  `<div class="tile"><div class="tile-label">${escape(label)}</div><div class="tile-value">${escape(value)}</div>${note ? `<div class="tile-note">${escape(note)}</div>` : ''}</div>`;

// One horizontal 100% stacked bar from labelled segments; 2px surface gaps, a
// tooltip per segment and a count label only where the segment is wide enough.
export function stackedBar(segments: { label: string; value: number; color: string }[]) {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  if (!total) return '<div class="bar empty" title="No trials">no trials</div>';
  return `<div class="bar">${segments
    .filter((item) => item.value > 0)
    .map((item) => {
      const share = item.value / total;
      return `<span style="flex:${item.value};background:${item.color}" title="${escape(`${item.label}: ${item.value} of ${total}`)}">${share >= 0.12 ? escape(String(item.value)) : ''}</span>`;
    })
    .join('')}</div>`;
}

const niceStep = (span: number) => {
  const raw = span / 4;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((step) => step >= raw) ?? power * 10;
};
// Dot strip plot: one row per configuration, one dot per trial on a shared
// linear x axis starting at zero. Each dot has a surface ring and a tooltip.
export function stripPlot(
  rows: { label: string; color: string; points: { value: number; tip: string }[] }[],
  format: (value: number) => string,
) {
  const values = rows.flatMap((row) => row.points.map((point) => point.value));
  if (!values.length) return '<p class="muted">No measured trials.</p>';
  const step = niceStep(Math.max(...values));
  const max = Math.max(step, Math.ceil(Math.max(...values) / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(value);
  const at = (value: number) => `${((value / max) * 100).toFixed(2)}%`;
  const grid = ticks.map((value) => `<b class="gridline" style="left:${at(value)}"></b>`).join('');
  const track = (row: (typeof rows)[number]) =>
    `<div class="track">${grid}${row.points
      .map(
        (point) =>
          `<i class="dotmark" style="left:${at(point.value)};background:${row.color}" title="${escape(point.tip)}"></i>`,
      )
      .join('')}</div>`;
  // HTML/CSS rather than SVG text, so labels keep the page's type size at any width.
  return `<div class="strip">${rows
    .map((row) => `<div class="strip-label">${escape(row.label)}</div>${track(row)}`)
    .join('')}<div></div><div class="ticks">${ticks
    .map((value) => `<span style="left:${at(value)}">${escape(format(value))}</span>`)
    .join('')}</div></div>`;
}

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
:root { color-scheme: dark; --plane: #0d0d0d; --surface: #1a1a19; --raised: #222221; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10); }
* { box-sizing: border-box; }
html, body { background: var(--plane); }
body { font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); margin: 0 auto; max-width: 1080px; padding: 28px 16px 64px; overflow-wrap: anywhere; }
h1 { font-size: 1.6rem; font-weight: 650; margin: 0 0 .25rem; letter-spacing: -.01em; }
h2 { font-size: 1.05rem; font-weight: 600; margin: 2.4rem 0 .75rem; }
h3 { font-size: .95rem; font-weight: 600; margin: 1.2rem 0 .5rem; }
p { margin: .4rem 0; }
a { color: var(--ink); text-decoration-color: var(--muted); text-underline-offset: 3px; }
code { font: .82rem/1.4 ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--ink-2); }
pre { white-space: pre-wrap; background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; padding: 12px; margin: .5rem 0; }
.muted { color: var(--muted); } .sub { color: var(--ink-2); } .small { font-size: .78rem; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: .6rem 0; }
.chip { border: 1px solid var(--ring); border-radius: 999px; padding: 2px 10px; font-size: .8rem; color: var(--ink-2); }
.note { border-left: 2px solid var(--axis); padding: 2px 0 2px 12px; color: var(--ink-2); margin: .8rem 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin: 1.2rem 0; }
.tile { background: var(--surface); border: 1px solid var(--ring); border-radius: 12px; padding: 14px 16px; }
.tile-label { color: var(--ink-2); font-size: .8rem; }
.tile-value { font-size: 1.7rem; font-weight: 650; margin-top: 2px; }
.tile-note { color: var(--muted); font-size: .78rem; }
.panel { background: var(--surface); border: 1px solid var(--ring); border-radius: 14px; padding: 16px 18px; margin: .6rem 0; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: .8rem; color: var(--ink-2); margin: 0 0 10px; }
.legend span, .key { display: inline-flex; align-items: center; gap: 6px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; }
.bars { display: grid; grid-template-columns: minmax(90px, 160px) 1fr; gap: 10px 14px; align-items: center; }
.bar { display: flex; gap: 2px; height: 22px; border-radius: 4px; overflow: hidden; }
.bar span { display: flex; align-items: center; justify-content: center; font-size: .72rem; font-weight: 600; color: #0d0d0d; min-width: 3px; }
.bar.empty { color: var(--muted); font-size: .8rem; align-items: center; }
.matrix { display: grid; gap: 6px 12px; align-items: center; font-size: .82rem; }
.matrix .head { color: var(--muted); font-size: .75rem; }
.stack > .panel + .panel { margin-top: 10px; }
.strip { display: grid; grid-template-columns: minmax(70px, 140px) 1fr; gap: 8px 14px; align-items: center; padding: 6px 18px 0 0; font-size: .82rem; }
.strip-label { color: var(--ink-2); text-align: right; }
.track { position: relative; height: 26px; }
.gridline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--grid); }
.dotmark { position: absolute; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface); }
.ticks { position: relative; height: 18px; color: var(--muted); font-size: .74rem; font-variant-numeric: tabular-nums; }
.ticks span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.configs { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
dl.kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; margin: .5rem 0 0; font-size: .85rem; }
dl.kv dt { color: var(--ink-2); } dl.kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: .8rem; white-space: nowrap; }
.pill i { display: inline-flex; width: 16px; height: 16px; border-radius: 50%; align-items: center; justify-content: center; font-style: normal; font-size: .68rem; font-weight: 700; color: #0d0d0d; }
details.trial { background: var(--surface); border: 1px solid var(--ring); border-radius: 12px; margin: 8px 0; }
details.trial > summary { cursor: pointer; padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; list-style: none; }
details.trial > summary::-webkit-details-marker { display: none; }
details.trial > summary::before { content: '▸'; color: var(--muted); }
details.trial[open] > summary::before { content: '▾'; }
.trial-body { padding: 0 14px 14px; border-top: 1px solid var(--ring); }
.criterion { display: grid; grid-template-columns: 92px 1fr; gap: 4px 12px; padding: 10px 0; border-bottom: 1px solid var(--grid); }
.criterion:last-child { border-bottom: 0; }
.criterion .title { font-weight: 550; }
.criterion .meta { font-size: .78rem; color: var(--muted); }
.criterion .values { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: .82rem; margin-top: 4px; }
.criterion .values dt { color: var(--muted); }
.criterion .values dd { margin: 0; }
.explain { color: var(--ink); background: var(--raised); border-radius: 8px; padding: 10px 14px; margin: 10px 0 0; font-size: .85rem; }
.explain ul { margin: 6px 0 0; padding-left: 18px; color: var(--ink-2); } .explain li + li { margin-top: 3px; }
.tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-top: 10px; font-size: .82rem; }
.tools div { background: var(--raised); border-radius: 8px; padding: 8px 10px; }
.tools b { display: block; font-weight: 550; color: var(--ink-2); font-size: .75rem; margin-bottom: 2px; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: .5rem 0 1rem; font-size: .86rem; }
th, td { border-bottom: 1px solid var(--grid); padding: 6px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--ink-2); font-weight: 550; }
.warn { color: #fab219; }
@media (max-width: 560px) { .bars { grid-template-columns: 1fr; gap: 4px; } .criterion { grid-template-columns: 1fr; } }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
