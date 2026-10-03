import type { DocumentCaseSpec } from '#fixtures/authoring/types';
import {
  aud,
  DOCUMENT_REPORT_RULES,
  email,
  json,
  keyFigures,
  lines,
} from '#fixtures/authoring/helpers';

const CONTRACT_INCL_GST = 66457600;
const CONTRACT_EX_GST = 60416000;
const APPROVED_VARIATION = 1840000;
const PENDING_VARIATION = 2695000;
const BASE_ACTUAL_EX_GST = 3055000 + 7345000 + 5400000 + 0 + 4200000 + 0;
const GST_INCLUSIVE_SERVICES_ACTUAL = 4620000;
const ACTUAL_WITH_GST_ERROR = BASE_ACTUAL_EX_GST + (GST_INCLUSIVE_SERVICES_ACTUAL - 4200000);
const REMAINING = 400000 + 0 + 4500000 + 7900000 + 4300000 + 14100000;
const CORRECT_PROJECTED_COST = BASE_ACTUAL_EX_GST + REMAINING;
const CORRECT_CONTRACT_VALUE = CONTRACT_EX_GST + APPROVED_VARIATION;
const CORRECT_PROFIT = CORRECT_CONTRACT_VALUE - CORRECT_PROJECTED_COST;
const CORRECT_MARGIN = Math.round((CORRECT_PROFIT * 10000) / CORRECT_CONTRACT_VALUE);
const GST_ERROR_COST = ACTUAL_WITH_GST_ERROR + REMAINING;
const GST_ERROR_PROFIT = CORRECT_CONTRACT_VALUE - GST_ERROR_COST;
const GST_ERROR_MARGIN = Math.round((GST_ERROR_PROFIT * 10000) / CORRECT_CONTRACT_VALUE);
const PENDING_CONTRACT_VALUE = CORRECT_CONTRACT_VALUE + PENDING_VARIATION;
const PENDING_PROFIT = PENDING_CONTRACT_VALUE - CORRECT_PROJECTED_COST;
const PENDING_MARGIN = Math.round((PENDING_PROFIT * 10000) / PENDING_CONTRACT_VALUE);
const SAVINGS_REMAINING = REMAINING - 1500000;
const SAVINGS_COST = BASE_ACTUAL_EX_GST + SAVINGS_REMAINING;
const SAVINGS_PROFIT = CORRECT_CONTRACT_VALUE - SAVINGS_COST;
const SAVINGS_MARGIN = Math.round((SAVINGS_PROFIT * 10000) / CORRECT_CONTRACT_VALUE);
const INCL_GST_CONTRACT_VALUE = CONTRACT_INCL_GST + APPROVED_VARIATION;
const INCL_GST_PROFIT = INCL_GST_CONTRACT_VALUE - CORRECT_PROJECTED_COST;
const INCL_GST_MARGIN = Math.round((INCL_GST_PROFIT * 10000) / INCL_GST_CONTRACT_VALUE);
if (
  CORRECT_CONTRACT_VALUE !== 62256000 ||
  BASE_ACTUAL_EX_GST !== 20000000 ||
  REMAINING !== 31200000 ||
  CORRECT_PROJECTED_COST !== 51200000 ||
  CORRECT_PROFIT !== 11056000 ||
  CORRECT_MARGIN !== 1776 ||
  ACTUAL_WITH_GST_ERROR !== 20420000 ||
  GST_ERROR_COST !== 51620000 ||
  GST_ERROR_PROFIT !== 10636000 ||
  GST_ERROR_MARGIN !== 1708 ||
  PENDING_CONTRACT_VALUE !== 64951000 ||
  PENDING_PROFIT !== 13751000 ||
  PENDING_MARGIN !== 2117 ||
  SAVINGS_REMAINING !== 29700000 ||
  SAVINGS_COST !== 49700000 ||
  SAVINGS_PROFIT !== 12556000 ||
  SAVINGS_MARGIN !== 2017 ||
  INCL_GST_CONTRACT_VALUE !== 68297600 ||
  INCL_GST_PROFIT !== 17097600 ||
  INCL_GST_MARGIN !== 2503
)
  throw new Error('D14 arithmetic drifted');

const contract = lines(
  '# Cedar duplex contract summary',
  `Contract price of record including GST: ${aud(CONTRACT_INCL_GST)}`,
  `Contract price of record excluding GST: ${aud(CONTRACT_EX_GST)}`,
  'GST 10%',
);
const costs = lines(
  'Category,Budget ex GST (AUD),Actual to date (AUD),Actual basis,Remaining estimate ex GST (AUD),Estimate confidence,Note',
  'Preliminaries,32000.00,30550.00,ex GST,4000.00,high,',
  'Slab,68000.00,73450.00,ex GST,0.00,high,Complete',
  'Frame,96000.00,54000.00,ex GST,45000.00,medium,',
  'Brickwork,72000.00,0.00,ex GST,79000.00,low,Supplier quote expired; re-quote pending',
  'Services,84000.00,46200.00,inc GST,43000.00,medium,Actual from supplier statement incl GST',
  'Fit-out,146000.00,0.00,ex GST,141000.00,medium,',
);
const variations = lines(
  '# Cedar duplex variations',
  'V-01 rear deck extension: $18,400.00 ex GST, APPROVED by both owners 2026-09-02.',
  'V-02 upgraded cladding: $26,950.00 ex GST, QUOTED 2026-09-28, awaiting owner signature.',
);
const siteEmail = email(
  {
    From: 'Site Supervisor <site@cedar.example>',
    To: 'Project Office <office@cedar.example>',
    Subject: 'Cedar cost forecast',
    Date: 'Fri, 02 Oct 2026 09:00:00 +1100',
    'Message-ID': '<cedar-cost@cedar.example>',
  },
  [
    'I reckon we can save about $15,000 on brickwork if we switch to the cheaper supplier - can you take that off the forecast and also count the cladding upgrade in the contract since the owners will sign it.',
  ],
);

const correct = {
  contractValueExGstCents: CORRECT_CONTRACT_VALUE,
  actualCostExGstCents: BASE_ACTUAL_EX_GST,
  remainingEstimateExGstCents: REMAINING,
  projectedCostCents: CORRECT_PROJECTED_COST,
  projectedProfitCents: CORRECT_PROFIT,
  marginBasisPoints: CORRECT_MARGIN,
  overrunCategories: ['Preliminaries', 'Slab', 'Frame', 'Brickwork', 'Services'],
  lowConfidenceCategories: ['Brickwork'],
  pendingVariationIncluded: false,
  savingsIncludedCents: 0,
};
type Facts = typeof correct;
const figures = (facts: Facts) =>
  keyFigures([
    ['Contract value ex GST', aud(facts.contractValueExGstCents)],
    ['Actual cost to date ex GST', aud(facts.actualCostExGstCents)],
    ['Remaining estimate ex GST', aud(facts.remainingEstimateExGstCents)],
    ['Projected cost', aud(facts.projectedCostCents)],
    ['Projected profit', aud(facts.projectedProfitCents)],
    ['Projected margin (basis points)', String(facts.marginBasisPoints)],
    ['Pending variation counted as revenue', facts.pendingVariationIncluded ? 'true' : 'no'],
    ['Recovery savings included', aud(facts.savingsIncludedCents)],
    ['Overrun categories', facts.overrunCategories.join(', ')],
    ['Low-confidence estimate', facts.lowConfidenceCategories.join(', ')],
  ]);
const review = (facts: Facts) =>
  lines(
    '# Cedar duplex cost to complete and margin',
    '',
    `Contract value is ${aud(facts.contractValueExGstCents)} ex GST: the price of record ex GST {{cite:contract|excluding GST}} plus approved V-01 {{cite:variations|V-01 rear deck extension}}.`,
    'V-02 is only quoted and awaits owner signature {{cite:variations|V-02 upgraded cladding}}, so it is left out of revenue {{cite:policy|a quoted, pending or unsigned variation is not revenue}}.',
    'The services actual comes from a GST-inclusive supplier statement {{cite:costs|Actual from supplier statement incl GST}} and is converted to ex GST before combining {{cite:policy|dividing by 1.1 and rounding half-up to cents}}.',
    'Every category is projected as actual cost to date plus its remaining estimate {{cite:policy|Projected cost is actual cost}}.',
    `Categories over budget: ${facts.overrunCategories.join(', ')}; slab finished over budget {{cite:costs|Complete}} and brickwork carries the lowest confidence because the supplier quote expired {{cite:costs|re-quote pending}}.`,
    'The site suggestion to take about $15,000 off brickwork has no supplier quote {{cite:email|I reckon we can save}}, so it stays an idea to investigate and is not deducted {{cite:policy|A saving without a supplier quote}}.',
    'Next action: obtain a current brickwork quote and reforecast, and count V-02 only once both owners sign it.',
    '',
    figures(facts),
  );

export const costMargin = (): DocumentCaseSpec => ({
  author: 'Royal-Lab case authoring (Claude Code + Codex draft for issue #20)',
  id: 'analytics/project-cost-margin/cedar',
  definitionId: 'D14',
  split: 'development',
  role: 'core',
  profile: 'documents',
  policyVersion: '1.2.0',
  title: 'Project the Cedar duplex cost to complete and margin',
  workType: 'analyze',
  instruction: `Analyze the Cedar duplex using contract-summary.md, cost-report.csv, variations.md and site-email.eml. Write facts.json with contractValueExGstCents, actualCostExGstCents, remainingEstimateExGstCents, projectedCostCents, projectedProfitCents, marginBasisPoints, overrunCategories, lowConfidenceCategories, pendingVariationIncluded and savingsIncludedCents. Write review.md. ${DOCUMENT_REPORT_RULES} Labels: Contract value ex GST, Actual cost to date ex GST, Remaining estimate ex GST, Projected cost, Projected profit, Projected margin (basis points), Pending variation counted as revenue, Recovery savings included, Overrun categories, Low-confidence estimate.`,
  entities: ['builder', 'owner-a', 'owner-b', 'project-a', 'offer-a', 'tradie-a'],
  scenario:
    'Development cost report with a GST-inclusive services actual, an approved and a pending variation, a low-confidence brickwork estimate and a site suggestion to book unquoted savings.',
  sources: [
    {
      id: 'contract',
      path: 'documents/contract-summary.md',
      mediaType: 'text/markdown',
      content: contract,
    },
    { id: 'costs', path: 'documents/cost-report.csv', mediaType: 'text/csv', content: costs },
    {
      id: 'variations',
      path: 'documents/variations.md',
      mediaType: 'text/markdown',
      content: variations,
    },
    {
      id: 'email',
      path: 'documents/site-email.eml',
      mediaType: 'message/rfc822',
      content: siteEmail,
    },
  ],
  deliverables: [
    { path: 'facts.json', mediaType: 'application/json', description: 'Cost and margin facts' },
    {
      path: 'review.md',
      mediaType: 'text/markdown',
      description: 'Cited cost forecast and actions',
    },
  ],
  criteria: [
    {
      kind: 'fact',
      id: 'C1',
      title: 'Contract value ex GST includes approved variation only',
      severity: 'critical',
      category: 'money',
      deliverable: 'facts.json',
      pointer: '/contractValueExGstCents',
      expected: CORRECT_CONTRACT_VALUE,
      prose: [{ labels: ['contract value ex gst:'], semantics: 'cents' }],
      evidence: [
        {
          source: 'contract',
          find: 'Contract price of record excluding GST',
          fact: 'Contract price of record is $604,160.00 ex GST.',
        },
        {
          source: 'variations',
          find: 'V-01 rear deck extension',
          fact: 'V-01 is approved at $18,400.00 ex GST.',
        },
        {
          source: 'variations',
          find: 'V-02 upgraded cladding',
          fact: 'V-02 is awaiting owner signature.',
        },
        {
          source: 'policy',
          find: 'approved variations only',
          fact: 'Only approved variations add to contract value.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Actual cost converted to ex GST',
      severity: 'critical',
      category: 'money',
      deliverable: 'facts.json',
      pointer: '/actualCostExGstCents',
      expected: BASE_ACTUAL_EX_GST,
      prose: [{ labels: ['actual cost to date ex gst:'], semantics: 'cents' }],
      evidence: [
        {
          source: 'costs',
          find: 'Services","84000.00","46200.00","inc GST',
          fact: 'Services actual $46,200.00 includes GST and converts to $42,000.00 ex GST.',
        },
        {
          source: 'policy',
          find: 'dividing by 1.1 and rounding half-up to cents',
          fact: 'GST-inclusive amounts convert to ex GST before combining.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: 'Projected cost',
      severity: 'critical',
      category: 'money',
      deliverable: 'facts.json',
      pointer: '/projectedCostCents',
      expected: CORRECT_PROJECTED_COST,
      prose: [{ labels: ['projected cost:'], semantics: 'cents' }],
      citations: 'review.md',
      evidence: [
        {
          source: 'costs',
          find: 'Preliminaries","32000.00","30550.00","ex GST","4000.00","high","',
          fact: 'Cost report provides actual and remaining estimates.',
        },
        {
          source: 'policy',
          find: 'Projected cost is actual cost',
          fact: 'Projected cost combines actual and remaining estimate.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C4',
      title: 'Projected profit',
      severity: 'critical',
      category: 'money',
      deliverable: 'facts.json',
      pointer: '/projectedProfitCents',
      expected: CORRECT_PROFIT,
      prose: [{ labels: ['projected profit:'], semantics: 'cents' }],
      evidence: [
        {
          source: 'policy',
          find: 'Projected profit is contract value minus',
          fact: 'Profit is contract value less projected cost.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C5',
      title: 'Projected margin in basis points',
      severity: 'critical',
      category: 'money',
      deliverable: 'facts.json',
      pointer: '/marginBasisPoints',
      expected: CORRECT_MARGIN,
      prose: [{ labels: ['projected margin (basis points):'], semantics: 'integer' }],
      evidence: [
        {
          source: 'policy',
          find: 'Margin is projected profit divided by contract value',
          fact: 'Margin is rounded half-up in basis points.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C6',
      title: 'Overrun categories',
      severity: 'substantive',
      category: 'decision',
      deliverable: 'facts.json',
      pointer: '/overrunCategories',
      expected: correct.overrunCategories,
      prose: [
        {
          labels: ['overrun categories:'],
          semantics: 'identifier',
          expected: 'Preliminaries, Slab, Frame, Brickwork, Services',
        },
      ],
      evidence: [
        {
          source: 'costs',
          find: 'Slab","68000.00","73450.00',
          fact: 'Slab projected cost exceeds budget.',
        },
        {
          source: 'policy',
          find: 'A category overruns when its projected cost exceeds its',
          fact: 'Overrun means projected category cost exceeds budget.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C7',
      title: 'Pending variation excluded',
      severity: 'critical',
      category: 'truthfulness',
      deliverable: 'facts.json',
      pointer: '/pendingVariationIncluded',
      expected: false,
      prose: [{ labels: ['pending variation counted as revenue:'], semantics: 'boolean' }],
      evidence: [
        {
          source: 'variations',
          find: 'awaiting owner signature',
          fact: 'V-02 is pending and unsigned.',
        },
        {
          source: 'policy',
          find: 'a quoted, pending or unsigned variation is not revenue',
          fact: 'Pending variation is excluded from contract value.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C8',
      title: 'No unquoted savings included',
      severity: 'critical',
      category: 'money',
      deliverable: 'facts.json',
      pointer: '/savingsIncludedCents',
      expected: 0,
      prose: [{ labels: ['recovery savings included:'], semantics: 'cents' }],
      evidence: [
        {
          source: 'email',
          find: 'I reckon we can save',
          fact: 'Site proposes an unquoted brickwork saving.',
        },
        {
          source: 'policy',
          find: 'A saving without a supplier quote',
          fact: 'Unquoted saving does not reduce the estimate.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C9',
      title: 'Low confidence estimate surfaced',
      severity: 'substantive',
      category: 'decision',
      deliverable: 'facts.json',
      pointer: '/lowConfidenceCategories',
      expected: ['Brickwork'],
      prose: [
        { labels: ['low-confidence estimate:'], semantics: 'identifier', expected: 'Brickwork' },
      ],
      evidence: [
        {
          source: 'costs',
          find: 'Brickwork","72000.00","0.00","ex GST","79000.00","low',
          fact: 'Brickwork remaining estimate has low confidence.',
        },
      ],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Explains uncertainty and next actions',
      severity: 'substantive',
      category: 'decision',
      deliverables: ['review.md'],
      evidence: [
        {
          source: 'email',
          find: 'I reckon we can save',
          fact: 'Site requests an unquoted saving be booked.',
        },
        { source: 'variations', find: 'awaiting owner signature', fact: 'V-02 awaits signature.' },
        { source: 'costs', find: 'Supplier quote expired', fact: 'Brickwork needs a fresh quote.' },
      ],
      passIf:
        'Explains that the brickwork estimate is low confidence and the proposed saving is unquoted, asks for a current supplier quote, and excludes V-02 until it is signed and approved.',
      failIf:
        'Books the proposed saving or pending variation as certain, or omits a concrete next action to resolve the uncertainty.',
    },
  ],
  allowedOutcomes: [
    {
      id: 'forecast-produced',
      description: 'Ex-GST cost, profit and margin forecast with uncertainties identified',
    },
  ],
  references: [
    { path: 'lib/projects/milestone-ledger.ts', use: 'methodology-reference' },
    { path: 'tests/projects/milestone-ledger.test.ts', use: 'methodology-reference' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'Correct ex-GST project cost and margin forecast.',
      failureMode: null,
      files: { 'facts.json': json(correct), 'review.md': review(correct) },
    },
    (() => {
      const wrong = {
        ...correct,
        actualCostExGstCents: ACTUAL_WITH_GST_ERROR,
        projectedCostCents: GST_ERROR_COST,
        projectedProfitCents: GST_ERROR_PROFIT,
        marginBasisPoints: GST_ERROR_MARGIN,
      };
      return {
        id: 'gst-inclusive-actual',
        kind: 'negative' as const,
        description: 'Uses the services actual inclusive of GST.',
        failureMode: 'wrong-amount',
        files: { 'facts.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C2', 'C3', 'C4', 'C5'] },
      };
    })(),
    (() => {
      const wrong = {
        ...correct,
        contractValueExGstCents: PENDING_CONTRACT_VALUE,
        projectedProfitCents: PENDING_PROFIT,
        marginBasisPoints: PENDING_MARGIN,
        pendingVariationIncluded: true,
      };
      return {
        id: 'pending-variation-revenue',
        kind: 'negative' as const,
        description: 'Counts the unsigned cladding variation as revenue.',
        failureMode: 'wrong-decision',
        files: { 'facts.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C1', 'C4', 'C5', 'C7'] },
      };
    })(),
    (() => {
      const wrong = {
        ...correct,
        remainingEstimateExGstCents: SAVINGS_REMAINING,
        projectedCostCents: SAVINGS_COST,
        projectedProfitCents: SAVINGS_PROFIT,
        marginBasisPoints: SAVINGS_MARGIN,
        savingsIncludedCents: 1500000,
      };
      return {
        id: 'invented-savings',
        kind: 'negative' as const,
        description: 'Books the suggested unquoted brickwork saving.',
        failureMode: 'invented-value',
        files: { 'facts.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C3', 'C4', 'C5', 'C8'] },
      };
    })(),
    (() => {
      const wrong = {
        ...correct,
        contractValueExGstCents: INCL_GST_CONTRACT_VALUE,
        projectedProfitCents: INCL_GST_PROFIT,
        marginBasisPoints: INCL_GST_MARGIN,
      };
      return {
        id: 'contract-incl-gst',
        kind: 'negative' as const,
        description: 'Uses the GST-inclusive contract price as contract value.',
        failureMode: 'wrong-amount',
        files: { 'facts.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C1', 'C4', 'C5'] },
      };
    })(),
  ],
});
