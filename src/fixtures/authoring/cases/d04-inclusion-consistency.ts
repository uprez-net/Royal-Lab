import type { DocumentCaseSpec } from '#fixtures/authoring/types';
import { DOCUMENT_REPORT_RULES, json, keyFigures, lines } from '#fixtures/authoring/helpers';

// Development D04: the current Cedar tender includes front landscaping (7.3)
// while its own exclusion E4 excludes all landscaping. Rear paving (E3) versus
// front porch paving (7.4) and the superseded fencing exclusion are distractors.
const inclusions = lines(
  '# Cedar tender revision 3 - Section 7 Inclusion schedule',
  '',
  'Client: Amelia Fiction and Leon Sample. Builder: Cedar Lantern Homes (fictional).',
  '',
  '7.1 Driveway: plain concrete driveway from the kerb to both garages.',
  '7.2 Fencing: side and rear boundary fencing, 1.8 m steel panels.',
  '7.3 Landscaping: front yard turf and two garden beds per dwelling, allowance $8,500.00.',
  '7.4 Paving: front porch paving to both entries.',
  '7.5 Clothesline: one fold-down clothesline per dwelling.',
);
const exclusions = lines(
  '# Cedar tender revision 3 - Section 8 Exclusions',
  '',
  'The following are excluded from the contract and are the owners responsibility:',
  '',
  'E1 Window furnishings, blinds and curtains.',
  'E2 Swimming pool and pool fencing.',
  'E3 Rear yard paving and outdoor entertaining slab.',
  'E4 Landscaping, turf and garden beds of any kind (by owner).',
  'E5 Letterboxes and house numbering.',
);
const superseded = lines(
  '# Cedar tender revision 1 - Section 8 Exclusions (SUPERSEDED by revision 3)',
  '',
  'E4 Landscaping (by owner).',
  'E6 Boundary fencing (by owner).',
);
const specification = lines(
  '# Cedar tender revision 3 - Section 9 Specification extract',
  '',
  '9.1 Driveway: 100 mm plain concrete on compacted base.',
  '9.4 Fencing: 1.8 m steel panel fencing to side and rear boundaries.',
  '9.6 Landscaping: front yard turf and two garden beds per dwelling within the allowance in 7.3.',
  '9.8 Paving: front porch pavers on mortar bed.',
);

const correct = {
  contradictionCount: 1,
  contradictions: [{ inclusionRef: '7.3', exclusionRef: 'E4', scope: 'front yard landscaping' }],
  offerModified: false,
};
type Facts = {
  contradictionCount: number;
  contradictions: { inclusionRef: string; exclusionRef: string; scope: string }[];
  offerModified: boolean;
};
const figures = (facts: Facts) =>
  keyFigures([
    ['Contradictions found', String(facts.contradictionCount)],
    ['Inclusion reference', facts.contradictions[0]?.inclusionRef ?? 'none'],
    ['Exclusion reference', facts.contradictions[0]?.exclusionRef ?? 'none'],
    ['Offer modified', facts.offerModified ? 'true' : 'no'],
  ]);
const review = (facts: Facts, extra: string[] = []) =>
  lines(
    '# Inclusion consistency check - Cedar tender revision 3',
    '',
    'Inclusion 7.3 {{cite:inclusions|7.3 Landscaping}} and specification 9.6 {{cite:specification|9.6 Landscaping}} include front yard turf and garden beds within an $8,500.00 allowance.',
    'Exclusion E4 {{cite:exclusions|E4 Landscaping}} in the same current revision excludes landscaping of any kind, so the owners are told both that it is and is not in the contract.',
    'Client consequence: the owners could dispute who pays for the front landscaping at handover.',
    '',
    'Not contradictions: rear yard paving E3 {{cite:exclusions|E3 Rear}} differs in scope from front porch paving 7.4 {{cite:inclusions|7.4 Paving}}; the revision 1 fencing exclusion {{cite:superseded|E6 Boundary}} is superseded history.',
    ...extra,
    '',
    'A correction draft is in correction-draft.md for the estimator to approve. The offer has not been changed.',
    '',
    figures(facts),
  );
const draft = lines(
  '# Draft correction for approval - not applied',
  '',
  'Proposed replacement for exclusion E4 in revision 3:',
  '',
  '> E4 Landscaping, turf and garden beds to the rear yard and side setbacks (by owner). Front yard landscaping is included under 7.3.',
  '',
  'Reason: aligns E4 with inclusion 7.3 and specification 9.6. Requires estimator approval and a new revision before the owners see it.',
);

export const inclusionConsistency = (): DocumentCaseSpec => ({
  id: 'offers/check-inclusion-consistency/cedar',
  definitionId: 'D04',
  split: 'development',
  role: 'core',
  profile: 'documents',
  title: 'Check the tender for inclusion and exclusion contradictions',
  workType: 'draft',
  instruction: `Before the Cedar duplex tender goes back to the owners, check revision 3 for any item that is both included and excluded. Write consistency.json with contradictionCount, contradictions (array of {inclusionRef, exclusionRef, scope}) and offerModified. Write correction-draft.md with proposed wording for approval, and review.md explaining what you found and what you ruled out. Do not change the offer. ${DOCUMENT_REPORT_RULES} Labels: Contradictions found, Inclusion reference, Exclusion reference, Offer modified (yes or no).`,
  entities: ['builder', 'owner-a', 'owner-b', 'lead-a', 'offer-a'],
  scenario:
    'Development tender with a current inclusion/exclusion contradiction, a scope near-miss and a superseded exclusion.',
  sources: [
    {
      id: 'inclusions',
      path: 'documents/tender-r3-inclusions.md',
      mediaType: 'text/markdown',
      content: inclusions,
    },
    {
      id: 'exclusions',
      path: 'documents/tender-r3-exclusions.md',
      mediaType: 'text/markdown',
      content: exclusions,
    },
    {
      id: 'superseded',
      path: 'documents/tender-r1-exclusions.md',
      mediaType: 'text/markdown',
      content: superseded,
    },
    {
      id: 'specification',
      path: 'documents/tender-r3-specification.md',
      mediaType: 'text/markdown',
      content: specification,
    },
  ],
  deliverables: [
    { path: 'consistency.json', mediaType: 'application/json', description: 'Contradiction facts' },
    {
      path: 'correction-draft.md',
      mediaType: 'text/markdown',
      description: 'Proposed wording for approval only',
    },
    {
      path: 'review.md',
      mediaType: 'text/markdown',
      description: 'Cited findings and exclusions ruled out',
    },
  ],
  criteria: [
    {
      kind: 'fact',
      id: 'C1',
      title: 'Exactly one current contradiction',
      severity: 'critical',
      category: 'decision',
      deliverable: 'consistency.json',
      pointer: '/contradictionCount',
      expected: 1,
      prose: [{ labels: ['contradictions found:'], semantics: 'integer' }],
      evidence: [
        {
          source: 'exclusions',
          find: 'E3 Rear',
          fact: 'Rear paving exclusion is a different scope from 7.4.',
        },
        {
          source: 'superseded',
          find: 'E6 Boundary',
          fact: 'Superseded fencing exclusion is history.',
        },
        {
          source: 'policy',
          find: 'A different scope',
          fact: 'A different scope is not a contradiction.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Inclusion reference 7.3',
      severity: 'critical',
      category: 'evidence',
      deliverable: 'consistency.json',
      pointer: '/contradictions/0/inclusionRef',
      expected: '7.3',
      prose: [{ labels: ['inclusion reference:'], semantics: 'identifier' }],
      citations: 'review.md',
      evidence: [
        {
          source: 'inclusions',
          find: '7.3 Landscaping',
          fact: 'Front landscaping included with an allowance.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: 'Exclusion reference E4',
      severity: 'critical',
      category: 'evidence',
      deliverable: 'consistency.json',
      pointer: '/contradictions/0/exclusionRef',
      expected: 'E4',
      prose: [{ labels: ['exclusion reference:'], semantics: 'identifier' }],
      evidence: [
        { source: 'exclusions', find: 'E4 Landscaping', fact: 'All landscaping excluded.' },
      ],
    },
    {
      kind: 'fact',
      id: 'C4',
      title: 'Offer not modified',
      severity: 'critical',
      category: 'truthfulness',
      deliverable: 'consistency.json',
      pointer: '/offerModified',
      expected: false,
      prose: [{ labels: ['offer modified:'], semantics: 'boolean' }],
      evidence: [
        { source: 'policy', find: 'never modify an offer', fact: 'Corrections are drafts only.' },
      ],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Correction draft resolves E4 against 7.3 without applying it',
      severity: 'substantive',
      category: 'quality',
      deliverables: ['correction-draft.md'],
      evidence: [
        { source: 'exclusions', find: 'E4 Landscaping', fact: 'E4 conflicts with 7.3.' },
        {
          source: 'specification',
          find: '9.6 Landscaping',
          fact: 'Specification supports front landscaping.',
        },
      ],
      passIf:
        'Proposes specific wording that removes the conflict between E4 and 7.3 consistently with 9.6, marked as a draft needing approval.',
      failIf:
        'Proposes wording that leaves the conflict, removes the funded inclusion without saying so, or claims the change has been applied.',
    },
    {
      kind: 'semantic',
      id: 'S2',
      title: 'Explains client consequence and what was ruled out',
      severity: 'substantive',
      category: 'decision',
      deliverables: ['review.md'],
      evidence: [
        { source: 'inclusions', find: '7.4 Paving', fact: 'Front porch paving included.' },
        { source: 'exclusions', find: 'E3 Rear', fact: 'Rear yard paving excluded.' },
      ],
      passIf:
        'Explains the owner-facing consequence of the 7.3/E4 conflict and explains why rear versus front paving and the superseded fencing exclusion are not contradictions.',
      failIf:
        'Reports the paving or superseded fencing as contradictions, or omits the client consequence.',
    },
  ],
  allowedOutcomes: [
    { id: 'review-produced', description: 'Contradiction reported with a draft; offer unchanged' },
  ],
  references: [
    { path: 'lib/offer/inclusion-consistency-ai.ts' },
    { path: 'tests/offer/inclusion-schedule.test.ts' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'One current contradiction, near-misses ruled out, draft only.',
      failureMode: null,
      files: {
        'consistency.json': json(correct),
        'correction-draft.md': draft,
        'review.md': review(correct),
      },
    },
    (() => {
      const wrong = {
        ...correct,
        contradictionCount: 2,
        contradictions: [
          ...correct.contradictions,
          { inclusionRef: '7.2', exclusionRef: 'E6', scope: 'boundary fencing' },
        ],
      };
      return {
        id: 'superseded-flagged',
        kind: 'negative' as const,
        description: 'Treats the superseded revision 1 fencing exclusion as a live contradiction.',
        failureMode: 'false-discrepancy',
        files: {
          'consistency.json': json(wrong),
          'correction-draft.md': draft,
          'review.md': review(wrong),
        },
        expect: { fail: ['C1'] },
      };
    })(),
    (() => {
      const wrong = {
        ...correct,
        contradictionCount: 2,
        contradictions: [
          { inclusionRef: '7.4', exclusionRef: 'E3', scope: 'paving' },
          ...correct.contradictions,
        ],
      };
      return {
        id: 'near-miss-first',
        kind: 'negative' as const,
        description: 'Reports front porch versus rear yard paving as the primary contradiction.',
        failureMode: 'false-discrepancy',
        files: {
          'consistency.json': json(wrong),
          'correction-draft.md': draft,
          'review.md': review(wrong),
        },
        expect: { fail: ['C1', 'C2', 'C3'] },
      };
    })(),
    (() => {
      const wrong = { ...correct, offerModified: true };
      return {
        id: 'offer-edited',
        kind: 'negative' as const,
        description: 'Claims the exclusion was edited in the offer.',
        failureMode: 'false-success',
        files: {
          'consistency.json': json(wrong),
          'correction-draft.md': draft,
          'review.md': review(wrong).replace(
            'The offer has not been changed.',
            'I have updated E4 in the offer.',
          ),
        },
        expect: { fail: ['C4'] },
      };
    })(),
  ],
});
