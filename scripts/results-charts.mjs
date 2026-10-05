// Renders the v0.1 baseline charts as static SVG for the docs and README.
// Input: saved experiment report JSON (pnpm lab report <id> --format json),
// found under results/ for the four v0.1 experiments. Output: docs/images/.
// Offline: reads saved reports only, never runs or grades anything.
// Usage: node scripts/results-charts.mjs [--out docs/images]
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outArg = process.argv.indexOf('--out');
const outDir = path.join(root, outArg > 0 ? process.argv[outArg + 1] : 'docs/images');

const PARTITIONS = [
  ['v0.1-documents-development', 'Documents · development'],
  ['v0.1-documents-held-out', 'Documents · held-out'],
  ['v0.1-tools-development', 'Fixed tools · development'],
  ['v0.1-tools-held-out', 'Fixed tools · held-out'],
];
// Validated categorical slots 1–2 (light surface) and an ordinal blue ramp.
const C = {
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#8a8984',
  grid: '#e6e5e0',
  series: ['#2a78d6', '#eb6834'],
  ramp: ['#ecebe7', '#86b6ef', '#5598e7', '#256abf'],
};
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
// Latest saved JSON report for each v0.1 experiment, whichever results folder holds it.
const reports = {};
for (const file of walk(path.join(root, 'results')).filter((f) =>
  /reports[\\/]report-[^\\/]+\.json$/.test(f),
)) {
  let r;
  try {
    r = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  const prefix = PARTITIONS.find(([id]) => r.experimentId?.startsWith(id + '-'))?.[0];
  if (!prefix) continue;
  if (!reports[prefix] || path.basename(file) > path.basename(reports[prefix].file))
    reports[prefix] = { file, r };
}
const available = PARTITIONS.filter(([id]) => reports[id]);
if (!available.length) throw new Error('No v0.1 experiment reports found under results/');
const configIds = [
  ...new Set(
    available.flatMap(([id]) => reports[id].r.configurations.map((c) => c.configurationId)),
  ),
];

const svg = (w, h, title, desc, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d" font-family="${FONT}">\n` +
  `<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>\n` +
  `<rect width="${w}" height="${h}" rx="12" fill="${C.surface}"/>\n${body}\n</svg>\n`;
const text = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 13}" fill="${o.fill ?? C.ink}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;

// 1. Where every trial ended, per partition and configuration. Nothing is
// dropped: a trial is a strict pass, a graded failure, not fully graded
// (judge disagreement or unverifiable prose), or a candidate failure.
const OUTCOMES = [
  ['pass', 'Strict pass', C.series[0]],
  ['fail', 'Failed', C.series[1]],
  ['ungraded', 'Not fully graded', '#1baf7a'],
  ['candidate', 'Candidate failure', '#eda100'],
];
const outcomeOf = (t) =>
  t.strictSuccess
    ? 'pass'
    : t.status !== 'completed'
      ? 'candidate'
      : t.gradingStatus === 'graded'
        ? 'fail'
        : 'ungraded';
function outcomeChart() {
  const labelW = 250,
    barW = 520,
    top = 104,
    rowH = 24,
    groupGap = 30;
  const rows = [];
  for (const [id, label] of available) {
    rows.push({ group: label });
    for (const cid of configIds) {
      const trials = reports[id].r.trials.filter((t) => t.configurationId === cid);
      const n = Object.fromEntries(
        OUTCOMES.map(([k]) => [k, trials.filter((t) => outcomeOf(t) === k).length]),
      );
      rows.push({ cid, n, total: trials.length });
    }
  }
  const H = top + rows.reduce((h, r) => h + (r.group ? groupGap : rowH + 6), 0) + 20;
  const W = 24 + labelW + barW + 70;
  let b = text(24, 34, 'v0.1 baseline: how every trial ended', { size: 18, weight: 600 });
  b += text(24, 56, '3 repeats of every core case per configuration; no trial is dropped', {
    fill: C.ink2,
  });
  OUTCOMES.forEach(
    ([, name, fill], i) =>
      (b +=
        `<rect x="${24 + i * 170}" y="68" width="12" height="12" rx="3" fill="${fill}"/>` +
        text(24 + i * 170 + 18, 78, name, { size: 12, fill: C.ink2 })),
  );
  let y = top;
  for (const row of rows) {
    if (row.group) {
      b += text(24, y + 18, row.group, { weight: 600 });
      y += groupGap;
      continue;
    }
    b += text(40, y + 16, row.cid, { size: 13, fill: C.ink2 });
    let x = 24 + labelW;
    for (const [k, name, fill] of OUTCOMES) {
      const v = row.n[k];
      if (!v) continue;
      const w = (v / row.total) * barW;
      // 2px surface gap between segments; counts sit inside when they fit.
      b += `<rect x="${x}" y="${y}" width="${Math.max(1, w - 2)}" height="${rowH}" rx="3" fill="${fill}"><title>${esc(`${row.cid}: ${v} of ${row.total} ${name.toLowerCase()}`)}</title></rect>`;
      if (w > 14)
        b += text(x + (w - 2) / 2, y + 16, String(v), {
          size: 12,
          anchor: 'middle',
          fill: k === 'pass' || k === 'fail' ? '#ffffff' : C.ink,
          weight: 600,
        });
      x += w;
    }
    b += text(24 + labelW + barW + 8, y + 16, `${row.total} trials`, { size: 12, fill: C.muted });
    y += rowH + 6;
  }
  return svg(
    W,
    H,
    'v0.1 trial outcomes',
    'Stacked outcome of every trial by partition and configuration: strict pass, failed, not fully graded, candidate failure.',
    b,
  );
}

// 2. Per-case grid: successes out of 3 for each configuration.
function caseChart() {
  const rows = [];
  for (const [id, label] of available) {
    const r = reports[id].r;
    const defs = Object.fromEntries(r.trials.map((t) => [t.taskId, t.definitionId]));
    const titles = Object.fromEntries(
      (r.identity.cases ?? []).map((c) => [c.taskId, c.title]).filter(([, t]) => t),
    );
    const tasks = [...new Set(r.trials.map((t) => t.taskId))].sort((a, b) =>
      (defs[a] || a).localeCompare(defs[b] || b),
    );
    rows.push({ group: label });
    for (const taskId of tasks)
      rows.push({
        taskId,
        label: `${defs[taskId] ?? ''}  ${titles[taskId] ?? taskId.split('/')[1].replace(/-/g, ' ')}`,
        cells: configIds.map(
          (cid) =>
            r.configurations
              .find((c) => c.configurationId === cid)
              ?.withinCase?.find((w) => w.taskId === taskId) ?? null,
        ),
      });
  }
  const labelW = 360,
    cellW = 92,
    cellH = 22,
    top = 96;
  const W = 24 + labelW + configIds.length * (cellW + 6) + 24;
  const H = top + rows.reduce((h, row) => h + (row.group ? 30 : cellH + 3), 0) + 30;
  let b = text(24, 34, 'v0.1 baseline: strict successes per case (out of 3)', {
    size: 18,
    weight: 600,
  });
  b += text(
    24,
    56,
    'Each cell is one configuration on one core case; darker means more of its 3 repeats fully passed',
    { fill: C.ink2 },
  );
  configIds.forEach(
    (cid, i) =>
      (b += text(24 + labelW + i * (cellW + 6) + cellW / 2, top - 10, cid, {
        size: 12,
        anchor: 'middle',
        fill: C.ink2,
        weight: 600,
      })),
  );
  ['0', '1', '2', '3'].forEach(
    (s, i) =>
      (b +=
        `<rect x="${24 + i * 46}" y="${70}" width="16" height="12" rx="3" fill="${C.ramp[i]}"/>` +
        text(24 + i * 46 + 21, 81, s, { size: 11, fill: C.ink2 })),
  );
  let y = top;
  for (const row of rows) {
    if (row.group) {
      b += text(24, y + 20, row.group, { weight: 600 });
      y += 30;
      continue;
    }
    b += text(24, y + 15, row.label.length > 58 ? row.label.slice(0, 57) + '…' : row.label, {
      size: 12,
      fill: C.ink2,
    });
    row.cells.forEach((w, i) => {
      const x = 24 + labelW + i * (cellW + 6);
      const s = w ? w.successes : null;
      const fill = s == null ? C.surface : C.ramp[Math.max(0, Math.min(3, s))];
      b += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="4" fill="${fill}" stroke="${s == null ? C.grid : 'none'}"><title>${esc(`${configIds[i]} · ${row.taskId}: ${s ?? '—'} of ${w?.trials ?? 3}`)}</title></rect>`;
      b += text(x + cellW / 2, y + 15, s == null ? '—' : `${s}/${w.trials}`, {
        size: 12,
        anchor: 'middle',
        fill: s === 3 ? '#ffffff' : C.ink,
      });
    });
    y += cellH + 3;
  }
  return svg(
    W,
    H,
    'v0.1 per-case strict successes',
    'Grid of strict successes out of three repeats for each core case and configuration.',
    b,
  );
}

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'v0.1-outcomes.svg'), outcomeChart());
writeFileSync(path.join(outDir, 'v0.1-cases.svg'), caseChart());

// A compact numbers file the results page can quote.
const summary = available.map(([id, label]) => {
  const r = reports[id].r;
  return {
    partition: label,
    experimentId: r.experimentId,
    report: path.relative(root, reports[id].file).replaceAll('\\', '/'),
    configurations: r.configurations.map((c) => ({
      id: c.configurationId,
      planned: c.counts.planned,
      graded: c.counts.graded,
      passed: c.counts.passed,
      complete: c.complete,
      strictSuccessRate: c.headline?.strictSuccessRate ?? null,
      criticalGatePassRate: c.criticalGatePassRate ?? null,
      candidateUsd: c.spend?.candidateUsd ?? null,
      judgeUsd:
        typeof c.spend?.judgeUsd === 'number'
          ? c.spend.judgeUsd
          : (c.spend?.judgeUsd?.total ?? c.spend?.judgeUsd?.usd ?? null),
      latencyP50Ms: c.latencyMs?.p50 ?? null,
      failureCategories: c.failureCategories,
      outcomes: Object.fromEntries(
        OUTCOMES.map(([k]) => [
          k,
          r.trials.filter((t) => t.configurationId === c.configurationId && outcomeOf(t) === k)
            .length,
        ]),
      ),
    })),
  };
});
writeFileSync(path.join(outDir, 'v0.1-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(
  `charts for ${available.map(([, l]) => l).join(', ')} written to ${path.relative(root, outDir)}`,
);
