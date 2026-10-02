import type { DocumentCaseSpec } from '#fixtures/authoring/types';
import {
  aud,
  DOCUMENT_REPORT_RULES,
  email,
  json,
  keyFigures,
  lines,
} from '#fixtures/authoring/helpers';

// Development D02: Cedar offer revisions. A positive stored price is
// authoritative; a legacy zero is repaired from that revision's own build-up;
// an unpriced draft is unknown, never a $0 quotation.
const STORED_R3 = 66457600;
const COMPUTED_R3 = 66895000;
const REFRESH_PREVIEW = 67122000;
const R1_COMPUTED = 64218000;

const register = lines(
  'Revision,Status,Active,Created,Stored contract value inc GST (AUD),Register note',
  '1,SUPERSEDED,N,2026-06-12,0.00,Legacy save; stored value written as zero',
  '2,SUPERSEDED,N,2026-07-30,,Scope options draft; never priced',
  `3,TENDER_SENT,Y,2026-09-02,${(STORED_R3 / 100).toFixed(2)},Sent to client 2026-09-03`,
);
const rev1 = lines(
  '# Cedar duplex - revision 1 saved build-up',
  '',
  'Saved: 2026-06-12 by Cedar Lantern Homes estimating (fictional).',
  '',
  `- Computed contract value (incl. GST): ${aud(R1_COMPUTED)}`,
  '- Selected manual price: none recorded',
  '- Override reason: none',
  '',
  'This revision was superseded by revision 2 on 2026-07-30.',
);
const rev3 = lines(
  '# Cedar duplex - revision 3 saved build-up (as sent)',
  '',
  'Saved: 2026-09-02. Status at save: tender prepared for sending.',
  '',
  `- Computed contract value (incl. GST): ${aud(COMPUTED_R3)}`,
  `- Selected manual price (incl. GST): ${aud(STORED_R3)}`,
  '- Override reason: Matched to the owners budget after removing the media room joinery allowance',
  '',
  '## Rate refresh preview (not saved)',
  '',
  `Supplier rates refreshed on 2026-10-01. Preview only: recomputing revision 3 today would give ${aud(REFRESH_PREVIEW)}.`,
  'The preview was not saved to the revision and has not been sent to anyone.',
);
const proposal = lines(
  '# Proposal extract - Cedar Lantern Homes (fictional)',
  '',
  'Prepared for: Amelia Fiction and Leon Sample',
  'Project: Cedar duplex, 18 Imaginary Cedar Circuit, Synthetic Township NSW (fictional)',
  'Revision: 3',
  '',
  `Total contract price (including GST): ${aud(STORED_R3)}`,
  '',
  'This proposal is valid until 2026-10-31.',
);
const salesEmail = email(
  {
    From: 'Sam Notareal <sales@cedar.example>',
    To: 'Office <office@cedar.example>',
    Subject: 'Amelia duplex - price history for the owners',
    Date: 'Sat, 03 Oct 2026 15:12:00 +1000',
    'Message-ID': '<price-history@cedar.example>',
  },
  [
    'Hi,',
    '',
    'The owners want a one-page history of every version we have quoted.',
    'Revision 2 was the $0 one, right? I will list it as $0.00 unless you say otherwise.',
    'Also, rates went up this week - should the current price now be the',
    `refreshed ${aud(REFRESH_PREVIEW)}? I would rather use the latest number.`,
    '',
    'Sam',
  ],
);

const correct = {
  currentRevision: 3,
  priceOfRecordCents: STORED_R3,
  computedPriceCents: COMPUTED_R3,
  overrideVarianceCents: STORED_R3 - COMPUTED_R3,
  overrideReasonRecorded: true,
  // Keyed by revision: an exact null (unpriced) is compared by JSON equality.
  revisionPriceCents: { '1': R1_COMPUTED, '2': null, '3': STORED_R3 } as Record<
    string,
    number | null
  >,
  printedAmountMatches: true,
};
type Facts = typeof correct;
const figures = (facts: Facts) =>
  keyFigures([
    ['Current revision', String(facts.currentRevision)],
    ['Price of record', aud(facts.priceOfRecordCents)],
    ['Override variance', aud(facts.overrideVarianceCents)],
    ...(['1', '2'] as const).map((revision): [string, string] => {
      const price = facts.revisionPriceCents[revision] ?? null;
      return [`Revision ${revision} price`, price === null ? 'unpriced' : aud(price)];
    }),
  ]);
const review = (facts: Facts, opening: string) =>
  lines(
    '# Revision price history - Cedar duplex',
    '',
    opening,
    'Revision 3 is the only active revision {{cite:register|TENDER_SENT}} and its stored contract value is positive, so it is the price of record.',
    'Its saved build-up computed a higher figure but records a manual selected price with a reason {{cite:rev3|Override reason}}; the variance is disclosed below.',
    'The proposal sent to the owners prints the same amount {{cite:proposal|Total contract price}}.',
    'The rate refresh preview {{cite:rev3|Preview only}} was never saved and must not replace a price already sent.',
    '',
    'Revision 1 has a legacy zero stored value {{cite:register|Legacy save}}, so its price comes from its own saved build-up {{cite:rev1|Computed contract value}}.',
    'Revision 2 was never priced {{cite:register|never priced}}; it is reported as unpriced, not as a $0.00 quote.',
    '',
    'Reply to sales {{cite:email|$0.00 unless}}: do not list revision 2 at $0.00 and do not quote the refreshed figure. No revision was changed by this review.',
    '',
    figures(facts),
  );
const priceJson = (facts: Facts) => json(facts);

export const revisionPrice = (): DocumentCaseSpec => ({
  id: 'offers/explain-revision-price/cedar',
  definitionId: 'D02',
  split: 'development',
  role: 'core',
  profile: 'documents',
  title: 'Explain the client price across offer revisions',
  workType: 'reconcile',
  instruction: `Sales wants a price history for every version quoted to the owners of the Cedar duplex and has asked two questions in their email. Work out the current revision and the price of record for each revision under our policy. Write price.json with currentRevision (number), priceOfRecordCents, computedPriceCents (the current revision's saved computed price), overrideVarianceCents (price of record minus computed), overrideReasonRecorded, revisionPriceCents (an object keyed by revision number, e.g. {"1": ..., "2": ..., "3": ...}, using null for a revision with no price) and printedAmountMatches. Write review.md answering sales. ${DOCUMENT_REPORT_RULES} Labels: Current revision, Price of record, Override variance, Revision 1 price, Revision 2 price (write unpriced where a revision has no price).`,
  entities: ['builder', 'owner-a', 'owner-b', 'lead-a', 'offer-a'],
  scenario:
    'Development offer history with a positive stored price, legacy zero repaired from a saved build-up, an unpriced draft, a manual override and an unsaved rate-refresh preview.',
  sources: [
    {
      id: 'register',
      path: 'documents/revision-register.csv',
      mediaType: 'text/csv',
      content: register,
    },
    {
      id: 'rev1',
      path: 'documents/revision-1-build-up.md',
      mediaType: 'text/markdown',
      content: rev1,
    },
    {
      id: 'rev3',
      path: 'documents/revision-3-build-up.md',
      mediaType: 'text/markdown',
      content: rev3,
    },
    {
      id: 'proposal',
      path: 'documents/proposal-extract.md',
      mediaType: 'text/markdown',
      content: proposal,
    },
    {
      id: 'email',
      path: 'documents/sales-email.eml',
      mediaType: 'message/rfc822',
      content: salesEmail,
    },
  ],
  deliverables: [
    {
      path: 'price.json',
      mediaType: 'application/json',
      description: 'Price of record facts by revision',
    },
    {
      path: 'review.md',
      mediaType: 'text/markdown',
      description: 'Cited explanation and reply to sales',
    },
  ],
  criteria: [
    {
      kind: 'fact',
      id: 'C1',
      title: 'Current revision is the latest active revision',
      severity: 'critical',
      category: 'decision',
      deliverable: 'price.json',
      pointer: '/currentRevision',
      expected: 3,
      prose: [{ labels: ['current revision:'], semantics: 'integer' }],
      evidence: [
        {
          source: 'register',
          find: 'TENDER_SENT',
          fact: 'Revision 3 is the only active revision.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Positive stored price is authoritative and not recomputed',
      severity: 'critical',
      category: 'money',
      deliverable: 'price.json',
      pointer: '/priceOfRecordCents',
      expected: STORED_R3,
      prose: [{ labels: ['price of record:'], semantics: 'cents' }],
      citations: 'review.md',
      evidence: [
        { source: 'register', find: 'TENDER_SENT', fact: 'Revision 3 stored value $664,576.00.' },
        {
          source: 'rev3',
          find: 'Preview only',
          fact: 'The $671,220.00 refresh preview was never saved.',
        },
        {
          source: 'policy',
          find: 'Do not recompute',
          fact: 'A positive stored price is not recomputed.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: 'Legacy zero repaired from its own saved build-up',
      severity: 'critical',
      category: 'money',
      deliverable: 'price.json',
      pointer: '/revisionPriceCents/1',
      expected: R1_COMPUTED,
      prose: [{ labels: ['revision 1 price:'], semantics: 'cents' }],
      evidence: [
        {
          source: 'register',
          find: 'Legacy save',
          fact: 'Revision 1 stored value is a legacy zero.',
        },
        {
          source: 'rev1',
          find: 'Computed contract value',
          fact: 'Revision 1 computed $642,180.00.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C4',
      title: 'Unpriced revision is null, never $0',
      severity: 'critical',
      category: 'truthfulness',
      deliverable: 'price.json',
      pointer: '/revisionPriceCents/2',
      expected: null,
      prose: [{ labels: ['revision 2 price:'], semantics: 'identifier', expected: 'unpriced' }],
      evidence: [
        {
          source: 'register',
          find: 'never priced',
          fact: 'Revision 2 has no stored value or build-up.',
        },
        {
          source: 'policy',
          find: 'unpriced, never as',
          fact: 'An unpriced revision is never a $0.00 quote.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C5',
      title: 'Override variance disclosed',
      severity: 'substantive',
      category: 'money',
      deliverable: 'price.json',
      pointer: '/overrideVarianceCents',
      expected: STORED_R3 - COMPUTED_R3,
      evidence: [
        {
          source: 'rev3',
          find: 'Selected manual price',
          fact: 'Selected $664,576.00 against computed $668,950.00.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C6',
      title: 'Saved computed price, not the refresh preview',
      severity: 'substantive',
      category: 'money',
      deliverable: 'price.json',
      pointer: '/computedPriceCents',
      expected: COMPUTED_R3,
      evidence: [
        {
          source: 'rev3',
          find: 'Computed contract value',
          fact: 'Saved computed price $668,950.00.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C7',
      title: 'Override reason recorded',
      severity: 'substantive',
      category: 'evidence',
      deliverable: 'price.json',
      pointer: '/overrideReasonRecorded',
      expected: true,
      evidence: [
        {
          source: 'rev3',
          find: 'Override reason',
          fact: 'A reason is recorded for the manual price.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C8',
      title: 'Printed client amount agrees with the price of record',
      severity: 'substantive',
      category: 'money',
      deliverable: 'price.json',
      pointer: '/printedAmountMatches',
      expected: true,
      evidence: [
        { source: 'proposal', find: 'Total contract price', fact: 'Proposal prints $664,576.00.' },
      ],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Answers sales without a $0 quote or a recomputed price',
      severity: 'substantive',
      category: 'decision',
      deliverables: ['review.md'],
      evidence: [
        {
          source: 'email',
          find: '$0.00 unless',
          fact: 'Sales proposes listing revision 2 at $0.00.',
        },
        {
          source: 'email',
          find: 'refreshed',
          fact: 'Sales proposes using the refreshed $671,220.00.',
        },
      ],
      passIf:
        'Tells sales not to list revision 2 as $0.00, keeps $664,576.00 as the current price instead of the refresh preview, explains the legacy zero repair for revision 1 and states that no revision was changed.',
      failIf:
        'Endorses a $0.00 revision 2, adopts the refreshed preview, treats a superseded revision as current or claims a price was changed or sent.',
    },
  ],
  allowedOutcomes: [
    { id: 'review-produced', description: 'Price history explained; no revision changed' },
  ],
  references: [
    { path: 'lib/offer/offer-contract-value.ts' },
    { path: 'lib/offer/workspace-pricing.ts' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'Stored price kept, legacy zero repaired, unpriced draft reported as unpriced.',
      failureMode: null,
      files: {
        'price.json': priceJson(correct),
        'review.md': review(
          correct,
          'Answer: revision 3 remains the current price and revision 2 was never priced.',
        ),
      },
    },
    (() => {
      const wrong = {
        ...correct,
        priceOfRecordCents: REFRESH_PREVIEW,
        computedPriceCents: REFRESH_PREVIEW,
        overrideVarianceCents: 0,
      };
      return {
        id: 'recomputed-current',
        kind: 'negative' as const,
        description: 'Replaces the sent price with the unsaved rate-refresh preview.',
        failureMode: 'wrong-amount',
        files: {
          'price.json': priceJson(wrong),
          'review.md': review(wrong, 'Answer: the current price moves to the refreshed figure.'),
        },
        expect: { fail: ['C2', 'C5', 'C6'] },
      };
    })(),
    (() => {
      const wrong = { ...correct, revisionPriceCents: { '1': 0, '2': 0, '3': STORED_R3 } };
      return {
        id: 'zero-dollar-revisions',
        kind: 'negative' as const,
        description: 'Reports the legacy zero and the unpriced draft as $0.00 quotes.',
        failureMode: 'invented-value',
        files: {
          'price.json': priceJson(wrong),
          'review.md': review(wrong, 'Answer: revisions 1 and 2 were both $0.00.'),
        },
        expect: { fail: ['C3', 'C4'] },
      };
    })(),
    (() => {
      const wrong = { ...correct, currentRevision: 1, priceOfRecordCents: R1_COMPUTED };
      return {
        id: 'superseded-as-current',
        kind: 'negative' as const,
        description: 'Treats superseded revision 1 as the current offer.',
        failureMode: 'wrong-decision',
        files: {
          'price.json': priceJson(wrong),
          'review.md': review(wrong, 'Answer: revision 1 is the current price.'),
        },
        expect: { fail: ['C1', 'C2'] },
      };
    })(),
  ],
});
