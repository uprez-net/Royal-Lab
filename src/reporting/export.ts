import { redact } from '#src/config';
import { jsonText } from '#src/io';
import type { ExperimentReport } from '#reporting/report';
import type { Comparison } from '#reporting/compare';
import { escape, link, page, table } from '#reporting/templates/html';

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
const verdictClass = (verdict: string) =>
  verdict === 'pass' ? 'pass' : verdict === 'fail' || verdict === 'error' ? 'fail' : 'muted';

export function reportHtml(input: ExperimentReport) {
  const report = clean(input);
  const parts: string[] = [];
  parts.push(
    `<h1>${escape(report.label)} report</h1>`,
    `<p class="muted">Experiment <code>${escape(report.experimentId)}</code> · mode ${escape(report.mode)} · plan <code>${escape(report.identity.planHash)}</code></p>`,
    report.benchmarkEligible
      ? '<p>Benchmark-eligible experiment. Profiles are reported separately and never share a ranking.</p>'
      : '<p class="warn">Not benchmark-eligible: no score here is a benchmark result or model ranking.</p>',
    `<ul>${report.warnings.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>`,
    '<h2>Coverage</h2>',
    table(
      ['Selected', 'Compatible', 'Excluded', 'Planned cases', 'Not ready'],
      [
        [
          report.caseCounts.selected,
          report.caseCounts.compatible,
          report.caseCounts.excluded,
          report.caseCounts.planned,
          report.caseCounts.notReady,
        ].map((value) => escape(String(value))),
      ],
    ),
    '<h2>Configurations</h2>',
    table(
      [
        'Configuration',
        'Model',
        'Planned',
        'Completed',
        'Valid',
        'Failed',
        'Ungraded',
        'Invalid',
        'Missing',
        'Strict success',
        'Critical gates',
        'Macro family',
        'Candidate spend',
        'Judge spend',
        'Tokens in/out',
        'Latency p50/p90 ms',
      ],
      report.configurations.map((item) => [
        escape(item.configurationId),
        escape(`${item.provider}:${item.model}`),
        ...(
          ['planned', 'completed', 'valid', 'failed', 'ungraded', 'invalid', 'missing'] as const
        ).map((key) => escape(String(item.counts[key]))),
        item.headline.strictSuccessRate === null
          ? `<span class="warn">${escape(item.headline.reason)}</span>`
          : escape(`${pct(item.headline.strictSuccessRate)} of ${item.headline.denominator}`),
        escape(pct(item.criticalGatePassRate)),
        escape(pct(item.macroFamilyScore)),
        escape(
          `${usd(item.spend.candidateUsd)}${item.spend.unknownCostTrials ? ` (${item.spend.unknownCostTrials} unknown)` : ''}`,
        ),
        escape(usd(item.spend.judgeUsd)),
        escape(`${item.tokens.input ?? 'unknown'} / ${item.tokens.output ?? 'unknown'}`),
        escape(`${item.latencyMs.p50 ?? 'n/a'} / ${item.latencyMs.p90 ?? 'n/a'}`),
      ]),
    ),
  );
  for (const item of report.configurations) {
    parts.push(
      `<h3>${escape(item.configurationId)}: failures and variance</h3>`,
      table(
        ['Failure category', 'Trials'],
        Object.entries(item.failureCategories).map(([key, value]) => [
          escape(key),
          escape(String(value)),
        ]),
      ),
      table(
        ['Case', 'Trials', 'Successes', 'Rate', 'Within-case variance'],
        item.withinCase.map((row) => [
          escape(row.taskId),
          escape(String(row.trials)),
          escape(String(row.successes)),
          escape(pct(row.rate)),
          escape(row.variance.toFixed(3)),
        ]),
      ),
    );
  }
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
  parts.push('<h2>Trials</h2>');
  for (const row of report.trials) {
    const outcome = row.strictSuccess
      ? '<span class="pass">strict success</span>'
      : `<span class="fail">${escape(row.status)}</span>`;
    parts.push(
      `<details><summary>${escape(row.configurationId)} · r${escape(String(row.repeat))} · ${escape(row.definitionId)} ${escape(row.taskId)} — ${outcome} · ${escape(row.classification)} · graded: ${escape(row.gradingStatus)}${row.rerunOf ? ` · rerun of ${escape(row.rerunOf)}` : ''}</summary>`,
      `<p>Trial <code>${escape(row.trialId)}</code> · ${link(row.links.bundle, 'bundle')} · ${link(row.links.trace, 'trace')} · ${link(row.links.grade, 'grade')} · outputs: ${row.links.outputs.map((href) => link(href, href.split('/').at(-1)!)).join(', ') || 'none'}</p>`,
      row.explanations.length
        ? `<ul>${row.explanations.map((line) => `<li class="fail">${escape(line)}</li>`).join('')}</ul>`
        : '',
      table(
        ['Criterion', 'Severity', 'Verdict', 'Required', 'Actual', 'Evidence', 'Reason'],
        row.criteria.map((item) => [
          escape(`${item.id} ${item.title}`),
          escape(item.severity),
          `<span class="${verdictClass(item.verdict)}">${escape(item.verdict)}</span>`,
          `<code>${escape(item.expected)}</code>`,
          `<code>${escape(item.actual)}</code>`,
          item.evidence
            .map((evidence) =>
              escape(`[${evidence.sourceId} ${evidence.locator}] ${evidence.fact}`),
            )
            .join('<br>'),
          escape(item.reason),
        ]),
      ),
      table(
        ['Attempted tools', 'Executed (outcome)', 'Approvals', 'Committed effects'],
        [
          [
            escape(row.tools.attempted.map((item) => item.tool).join(', ') || 'none'),
            escape(
              row.tools.executed.map((item) => `${item.tool}:${item.outcome}`).join(', ') || 'none',
            ),
            escape(row.tools.approvals.map((item) => item.decision).join(', ') || 'none'),
            escape(
              row.tools.effects.map((item) => `${item.effect} (${item.operationId})`).join(', ') ||
                'none',
            ),
          ],
        ],
      ),
      row.judging
        ? `<p>Judging: ${escape(String(row.judging.criteria))} criteria, ${escape(String(row.judging.disagreements))} disagreement(s), ${escape(String(row.judging.adjudications))} human adjudication record(s).</p>`
        : '<p class="muted">No semantic judge receipt: semantic criteria are ungraded.</p>',
      '</details>',
    );
  }
  parts.push(
    '<h2>Run parameters</h2>',
    `<pre><code>${escape(JSON.stringify(report.identity, null, 2))}</code></pre>`,
  );
  return page(`${report.label} report ${report.experimentId}`, parts.join('\n'));
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
