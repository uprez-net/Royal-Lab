import { redact } from '#src/config';
import { jsonText } from '#src/io';
import type { ExperimentReport } from '#reporting/report';
import type { Comparison } from '#reporting/compare';
import {
  escape,
  link,
  page,
  pill,
  SERIES,
  STATUS,
  type StatusKey,
  stackedBar,
  stripPlot,
  swatch,
  table,
  tile,
} from '#reporting/templates/html';

// Exports are generated offline from a built report. Secrets are redacted first;
// HTML escapes every string from documents, candidates and judges.
const clean = <T>(value: T): T => redact(value) as T;
export const reportJson = (report: ExperimentReport) => jsonText(clean(report));

// CSV cells that start with a formula character are prefixed so spreadsheet
// tools never evaluate candidate or document text.
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function reportCsv(input: ExperimentReport) {
  const report = clean(input);
  const header = [
    'experimentId',
    'profile',
    'trialId',
    'rerunOf',
    'configurationId',
    'taskId',
    'definitionId',
    'role',
    'repeat',
    'block',
    'orderInBlock',
    'status',
    'classification',
    'coverage',
    'gradingStatus',
    'strictSuccess',
    'criticalGatesPassed',
    'failedCriteria',
    'toolAttempts',
    'toolExecutions',
    'blockedTools',
    'approvals',
    'committedEffects',
    'inputTokens',
    'outputTokens',
    'candidateCostUsd',
    'judgeCostUsd',
    'durationMs',
    'reason',
  ];
  const rows = report.trials.map((row) => [
    report.experimentId,
    report.kind,
    row.trialId,
    row.rerunOf,
    row.configurationId,
    row.taskId,
    row.definitionId,
    row.role,
    row.repeat,
    row.block,
    row.orderInBlock,
    row.status,
    row.classification,
    row.coverage,
    row.gradingStatus,
    row.strictSuccess,
    row.criticalGatesPassed,
    row.criteria
      .filter((item) => item.verdict === 'fail' || item.verdict === 'error')
      .map((item) => item.id)
      .join(' '),
    row.tools.attempted.length,
    row.tools.executed.length,
    row.tools.executed.filter((item) => item.outcome === 'blocked').length,
    row.tools.approvals.map((item) => item.decision).join(' '),
    row.tools.effects.length,
    row.usage.inputTokens,
    row.usage.outputTokens,
    row.usage.candidateCostUsd,
    row.usage.judgeCostUsd,
    row.usage.durationMs,
    row.reason,
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const usd = (value: number | null) => (value === null ? 'unknown' : `$${value.toFixed(4)}`);
const compactUsd = (value: number) =>
  value === 0 ? '$0' : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const count = (value: number | null) =>
  value === null ? 'unknown' : value.toLocaleString('en-AU');
const statusKey = (verdict: string): StatusKey =>
  verdict === 'pass' || verdict === 'fail' || verdict === 'error' ? verdict : 'ungraded';
const show = (value: unknown) =>
  value === null || value === undefined
    ? '<span class="muted">—</span>'
    : `<code>${escape(value)}</code>`;
type Row = ExperimentReport['trials'][number];

// Outcome of one trial for the outcome chart: a state, so status colours apply.
function outcomeOf(row: Row) {
  if (row.strictSuccess) return 'strict';
  if (row.status !== 'completed') return row.status === 'candidate-failure' ? 'candidate' : 'other';
  if (row.criticalGatesPassed === false) return 'critical';
  return row.criticalGatesPassed ? 'gates' : 'other';
}
const OUTCOMES = [
  { key: 'strict', label: 'Strict success', color: STATUS.pass.color },
  { key: 'gates', label: 'Critical gates passed, not a strict success', color: '#7fc97f' },
  { key: 'critical', label: 'Critical gate failed', color: STATUS.fail.color },
  { key: 'candidate', label: 'Candidate failure', color: '#ec835a' },
  { key: 'other', label: 'Infrastructure, budget or missing', color: STATUS.ungraded.color },
] as const;

export function reportHtml(input: ExperimentReport) {
  const report = clean(input);
  const colour = new Map(
    report.configurations.map((item, index) => [
      item.configurationId,
      SERIES[index % SERIES.length]!,
    ]),
  );
  const name = (id: string) =>
    `<span class="key">${swatch(colour.get(id) ?? '#898781')}${escape(id)}</span>`;
  const parts: string[] = [];
  const executed = report.trials.filter((row) => row.status !== 'budget-stopped');
  const candidateUsd = report.configurations.reduce(
    (sum, item) => sum + (item.spend.candidateUsd ?? 0),
    0,
  );
  const judgeUsd = report.configurations.reduce((sum, item) => sum + (item.spend.judgeUsd ?? 0), 0);
  const gated = report.trials.filter((row) => row.criticalGatesPassed !== null);
  const judge = report.identity.judge;
  parts.push(
    `<h1>${escape(report.label)}</h1>`,
    `<p class="sub">Experiment <code>${escape(report.experimentId)}</code></p>`,
    `<div class="chips"><span class="chip">mode ${escape(report.mode)}</span><span class="chip">suite ${escape(`${report.identity.suite.id} ${report.identity.suite.version}`)}</span><span class="chip">${escape(String(report.identity.repeats))} repeats</span><span class="chip">plan ${escape(report.identity.planHash.slice(0, 12))}</span><span class="chip">${judge ? escape(`judge ${judge.profileId} ${judge.profileVersion}`) : 'no judge'}</span></div>`,
    report.benchmarkEligible
      ? '<p class="note">Benchmark-eligible experiment. Profiles are reported separately and never share a ranking.</p>'
      : '<p class="note"><span class="warn">!</span> Not benchmark-eligible: no score here is a benchmark result or model ranking.</p>',
    ...report.warnings.map((item) => `<p class="note">${escape(item)}</p>`),
    '<div class="tiles">',
    tile(
      'Trials',
      String(report.trials.length),
      `${report.configurations.length} configurations × ${report.identity.repeats} repeats`,
    ),
    tile(
      'Critical gates passed',
      `${gated.filter((row) => row.criticalGatesPassed).length} / ${gated.length}`,
      'all trials with a gate verdict, candidate failures included',
    ),
    tile(
      'Strict successes',
      String(report.trials.filter((row) => row.strictSuccess).length),
      'every mandatory criterion passed',
    ),
    tile('Candidate spend', compactUsd(candidateUsd), 'recorded provider usage'),
    tile('Judge spend', compactUsd(judgeUsd), judge ? 'semantic criteria' : 'no judge profile'),
    '</div>',
  );

  // Trial outcomes per configuration: 100% stacked bar, status colours.
  parts.push(
    '<h2>Trial outcomes</h2>',
    '<div class="panel">',
    `<div class="legend">${OUTCOMES.map((item) => `<span>${swatch(item.color)}${escape(item.label)}</span>`).join('')}</div>`,
    '<div class="bars">',
    ...report.configurations.flatMap((item) => {
      const rows = report.trials.filter((row) => row.configurationId === item.configurationId);
      return [
        `<div>${name(item.configurationId)}<div class="muted small">${escape(item.model)}</div></div>`,
        stackedBar(
          OUTCOMES.map((outcome) => ({
            label: outcome.label,
            value: rows.filter((row) => outcomeOf(row) === outcome.key).length,
            color: outcome.color,
          })),
        ),
      ];
    }),
    '</div></div>',
  );

  // Criterion results: verdict mix per criterion and configuration.
  const criteria = [
    ...new Map(
      report.configurations
        .flatMap((item) => item.criterionDiagnostics)
        .map((row) => [`${row.taskId}#${row.criterionId}`, row] as const),
    ).values(),
  ];
  if (criteria.length)
    parts.push(
      '<h2>Criterion results</h2>',
      '<div class="panel">',
      `<div class="legend">${(['pass', 'fail', 'error', 'ungraded'] as const).map((key) => `<span>${pill(key)}</span>`).join('')}</div>`,
      `<div class="matrix" style="grid-template-columns:minmax(110px,1.3fr) repeat(${report.configurations.length},minmax(44px,1fr))">`,
      '<div class="head">Criterion</div>',
      ...report.configurations.map(
        (item) => `<div class="head">${name(item.configurationId)}</div>`,
      ),
      ...criteria.flatMap((criterion) => [
        `<div title="${escape(criterion.taskId)}"><b>${escape(criterion.criterionId)}</b> <span class="muted">${escape(`${criterion.taskId.split('/').slice(-2).join('/')} · ${criterion.severity}`)}</span></div>`,
        ...report.configurations.map((item) => {
          const row = item.criterionDiagnostics.find(
            (entry) =>
              entry.taskId === criterion.taskId && entry.criterionId === criterion.criterionId,
          );
          return row
            ? stackedBar(
                (['pass', 'fail', 'error', 'ungraded'] as const).map((key) => ({
                  label: `${item.configurationId} ${criterion.criterionId} ${key}`,
                  value: row[key],
                  color: STATUS[key].color,
                })),
              )
            : '<span class="muted">—</span>';
        }),
      ]),
      '</div></div>',
    );

  // Cost and duration per trial: one dot per trial on one axis each.
  const strip = (
    pick: (row: Row) => number | null,
    format: (value: number) => string,
    unit: string,
  ) =>
    stripPlot(
      report.configurations.map((item) => ({
        label: item.configurationId,
        color: colour.get(item.configurationId)!,
        points: executed
          .filter((row) => row.configurationId === item.configurationId && pick(row) !== null)
          .map((row) => ({
            value: pick(row)!,
            tip: `${item.configurationId} · repeat ${row.repeat} · ${row.definitionId} · ${unit} ${format(pick(row)!)} · ${row.status}`,
          })),
      })),
      format,
    );
  parts.push(
    '<h2>Cost and duration per trial</h2>',
    '<div class="stack">',
    `<div class="panel"><h3>Candidate cost</h3>${strip(
      (row) => row.usage.candidateCostUsd,
      (value) => `$${value.toFixed(value < 0.01 ? 4 : 2)}`,
      'cost',
    )}</div>`,
    `<div class="panel"><h3>Duration</h3>${strip((row) => row.usage.durationMs, seconds, 'duration')}</div>`,
    '</div>',
  );

  // Configuration cards: every count and rate, wrapping instead of a wide table.
  parts.push('<h2>Configurations</h2>', '<div class="configs">');
  const kv = (label: string, value: string) => `<dt>${escape(label)}</dt><dd>${value}</dd>`;
  for (const item of report.configurations) {
    const p50 = item.latencyMs.p50 === null ? 'n/a' : seconds(item.latencyMs.p50);
    const p90 = item.latencyMs.p90 === null ? 'n/a' : seconds(item.latencyMs.p90);
    parts.push(
      `<div class="panel"><h3>${name(item.configurationId)}</h3><p class="muted small">${escape(`${item.provider} · ${item.model}`)}</p>`,
      item.headline.strictSuccessRate === null
        ? `<p class="note">${escape(item.headline.reason)}</p>`
        : `<p class="tile-value">${escape(pct(item.headline.strictSuccessRate))}</p><p class="muted">strict success of ${escape(String(item.headline.denominator))}</p>`,
      '<dl class="kv">',
      kv('Planned / completed', escape(`${item.counts.planned} / ${item.counts.completed}`)),
      kv('Failed / ungraded', escape(`${item.counts.failed} / ${item.counts.ungraded}`)),
      kv('Invalid / missing', escape(`${item.counts.invalid} / ${item.counts.missing}`)),
      kv('Critical-gate rate', escape(pct(item.criticalGatePassRate))),
      kv('Macro family score', escape(pct(item.macroFamilyScore))),
      kv(
        'Candidate spend',
        escape(
          `${usd(item.spend.candidateUsd)}${item.spend.unknownCostTrials ? ` (+${item.spend.unknownCostTrials} unknown)` : ''}`,
        ),
      ),
      kv('Judge spend', escape(usd(item.spend.judgeUsd))),
      kv('Tokens in / out', escape(`${count(item.tokens.input)} / ${count(item.tokens.output)}`)),
      kv('Duration p50 / p90', escape(`${p50} / ${p90}`)),
      ...Object.entries(item.failureCategories).map(([key, value]) =>
        kv(`Outcome: ${key}`, escape(String(value))),
      ),
      '</dl>',
      item.withinCase.length
        ? `<h3>Per case</h3><dl class="kv">${item.withinCase
            .map((row) =>
              kv(
                row.taskId.split('/').slice(-2).join('/'),
                escape(`${row.successes}/${row.trials} · var ${row.variance.toFixed(3)}`),
              ),
            )
            .join('')}</dl>`
        : '',
      '</div>',
    );
  }
  parts.push('</div>');

  if (report.exclusions.length)
    parts.push(
      '<h2>Exclusions and blocked cases</h2>',
      table(
        ['Case', 'Status', 'Reason'],
        report.exclusions.map((row) => [
          escape(row.taskId),
          escape(row.status),
          escape(row.reason ?? ''),
        ]),
      ),
    );

  // Trials grouped by case; each is a collapsible card with stacked fields.
  parts.push('<h2>Trials</h2>');
  for (const taskId of [...new Set(report.trials.map((row) => row.taskId))]) {
    const rows = report.trials.filter((row) => row.taskId === taskId);
    parts.push(`<h3>${escape(rows[0]!.definitionId)} · <code>${escape(taskId)}</code></h3>`);
    for (const row of rows) parts.push(trialCard(row, name));
  }
  parts.push(
    '<h2>Run parameters</h2>',
    `<details class="trial"><summary>Frozen identity, hashes and configurations</summary><div class="trial-body"><pre><code>${escape(JSON.stringify(report.identity, null, 2))}</code></pre></div></details>`,
  );
  return page(`${report.label} report ${report.experimentId}`, parts.join('\n'));
}

function trialCard(row: Row, name: (id: string) => string) {
  const outcome = row.strictSuccess
    ? pill('pass', 'strict success')
    : row.status !== 'completed'
      ? pill('fail', row.status)
      : row.criticalGatesPassed === false
        ? pill('fail', 'critical gate failed')
        : row.criticalGatesPassed
          ? pill('pass', 'gates passed')
          : pill('ungraded', 'not graded');
  const passing = row.criteria.filter((item) => item.verdict === 'pass').length;
  const outputs = row.links.outputs.length
    ? ` · outputs: ${row.links.outputs.map((href) => link(href, href.split('/').at(-1)!)).join(', ')}`
    : '';
  const criterion = (item: Row['criteria'][number]) =>
    `<div class="criterion"><div>${pill(statusKey(item.verdict))}</div><div><div class="title">${escape(`${item.id} ${item.title}`)}</div><div class="meta">${escape(`${item.severity} · ${item.method} · ${item.category}`)}</div><dl class="values"><dt>Required</dt><dd>${show(item.expected)}</dd><dt>Actual</dt><dd>${show(item.actual)}</dd><dt>Reason</dt><dd>${escape(item.reason)}</dd>${item.evidence.length ? `<dt>Evidence</dt><dd>${item.evidence.map((evidence) => escape(`[${evidence.sourceId} ${evidence.locator}] ${evidence.fact}`)).join('<br>')}</dd>` : ''}</dl></div></div>`;
  const tools = [
    ['Attempted tools', row.tools.attempted.map((item) => item.tool).join(', ')],
    [
      'Executed (outcome)',
      row.tools.executed.map((item) => `${item.tool}: ${item.outcome}`).join(', '),
    ],
    ['Approvals', row.tools.approvals.map((item) => item.decision).join(', ')],
    [
      'Committed effects',
      row.tools.effects.map((item) => `${item.effect} (${item.operationId})`).join(', '),
    ],
    [
      'Usage',
      `${count(row.usage.inputTokens)} in / ${count(row.usage.outputTokens)} out · candidate ${usd(row.usage.candidateCostUsd)} · judge ${usd(row.usage.judgeCostUsd)}`,
    ],
    [
      'Judging',
      row.judging
        ? `${row.judging.criteria} criteria · ${row.judging.disagreements} disagreement(s) · ${row.judging.adjudications} human adjudication(s)`
        : 'No semantic judge receipt: semantic criteria are ungraded.',
    ],
  ];
  return [
    '<details class="trial">',
    `<summary>${name(row.configurationId)}<span class="muted">repeat ${escape(String(row.repeat))}</span>${outcome}<span class="muted">${escape(`${passing}/${row.criteria.length} criteria pass · graded: ${row.gradingStatus}`)}</span>${row.usage.durationMs === null ? '' : `<span class="muted">${escape(seconds(row.usage.durationMs))}</span>`}${row.rerunOf ? `<span class="muted">rerun of ${escape(row.rerunOf)}</span>` : ''}</summary>`,
    '<div class="trial-body">',
    `<p class="muted small">Trial <code>${escape(row.trialId)}</code> · ${link(row.links.bundle, 'bundle')} · ${link(row.links.trace, 'trace')} · ${link(row.links.grade, 'grade')}${outputs}${row.reason ? ` · reason: ${escape(row.reason)}` : ''}</p>`,
    row.explanations.length
      ? `<div class="explain"><b>${pill('fail', 'Why this trial did not succeed')}</b><ul>${row.explanations.map((line) => `<li>${escape(line)}</li>`).join('')}</ul></div>`
      : '',
    ...row.criteria.map(criterion),
    `<div class="tools">${tools.map(([label, value]) => `<div><b>${escape(label!)}</b>${escape(value || 'none')}</div>`).join('')}</div>`,
    '</div></details>',
  ].join('');
}

export function comparisonHtml(input: Comparison) {
  const comparison = clean(input);
  return page(
    comparison.label,
    [
      `<h1>${escape(comparison.label)}</h1>`,
      comparison.status === 'formal'
        ? '<p>All score-defining hashes match.</p>'
        : `<p class="warn">Exploratory: ${escape(comparison.mismatches.join('; '))}. No ranking is produced.</p>`,
      table(
        ['Arm', 'Experiment', 'Configuration', 'Model', 'Strict success', 'Complete'],
        comparison.arms.map((arm, index) => [
          escape(index === 0 ? 'A' : 'B'),
          escape(arm.experimentId),
          escape(arm.configurationId),
          escape(arm.model),
          escape(pct(arm.strictSuccessRate)),
          escape(String(arm.complete)),
        ]),
      ),
      `<p>Paired cases: ${escape(String(comparison.pairedCases))}; mean difference (B−A): ${escape(comparison.meanDifference === null ? 'n/a' : comparison.meanDifference.toFixed(3))}; 95% interval: ${escape(comparison.interval95 ? comparison.interval95.map((value) => value.toFixed(3)).join(' to ') : 'n/a')}; ranking: ${escape(comparison.ranking ?? 'none')}.</p>`,
      table(
        ['Case', 'A rate', 'B rate', 'A trials', 'B trials'],
        comparison.perCase.map((row) => [
          escape(row.taskId),
          escape(pct(row.a)),
          escape(pct(row.b)),
          escape(String(row.trialsA)),
          escape(String(row.trialsB)),
        ]),
      ),
      `<ul>${comparison.notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>`,
    ].join('\n'),
  );
}
