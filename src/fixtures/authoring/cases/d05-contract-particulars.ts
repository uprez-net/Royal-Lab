import type { DocumentCaseSpec } from '#fixtures/authoring/types';
import {
  aud,
  DOCUMENT_REPORT_RULES,
  email,
  json,
  keyFigures,
  lines,
} from '#fixtures/authoring/helpers';

// Development D05: the signed contract governs owners, site lot, price, date and
// build period. The tender has a lot typo and a shorter period; the builder,
// witness and footer details must never become owners.
const PRICE = 66457600;
const tender = lines(
  '# Tender - revision 3 (Cedar Lantern Homes, fictional)',
  '',
  'Prepared for: Amelia Fiction (enquiry contact)',
  'Site: Lot 41, 18 Imaginary Cedar Circuit, Synthetic Township NSW (fictional)',
  `Tender price (incl. GST): ${aud(PRICE)}`,
  'Estimated build period: 48 weeks from site start',
  'Scope: two-dwelling duplex as per drawings DA-01 to DA-14.',
  '',
  '---',
  'Cedar Lantern Homes | office@cedar.example | fictional builder footer',
);
const contract = lines(
  '# Residential building contract - signed extract (fictional form)',
  '',
  '## Item 1 - Owner(s)',
  '',
  'Owner 1: Amelia Fiction, of 3 Fictional Grove, Synthetic Township NSW (fictional), amelia@owners-cedar.example',
  'Owner 2: Leon Sample, of 3 Fictional Grove, Synthetic Township NSW (fictional)',
  '',
  '## Item 2 - Builder',
  '',
  'Builder: Cedar Lantern Homes, contractor licence CL-58214 (fictional), office@cedar.example',
  'Builder representative: Morgan Notreal, Director',
  '',
  '## Item 3 - Site',
  '',
  'Land: Lot 14, 18 Imaginary Cedar Circuit, Synthetic Township NSW (fictional)',
  '',
  '## Item 4 - Contract price',
  '',
  `Contract price (incl. GST): ${aud(PRICE)}`,
  '',
  '## Item 5 - Build period',
  '',
  'Building period: 52 weeks from the date of commencement',
  '',
  '## Execution',
  '',
  'Date of this contract: 21 September 2026',
  'Signed by the Owner(s) in the presence of witness: Priya Placeholder',
  'Signed for the Builder: Morgan Notreal',
  '',
  '---',
  'Cedar Lantern Homes | office@cedar.example | page 1 of 2 (extract)',
);
const handover = email(
  {
    From: 'Sam Notareal <sales@cedar.example>',
    To: 'Office <office@cedar.example>',
    Subject: 'New job handover - Amelia duplex',
    Date: 'Wed, 23 Sep 2026 09:14:00 +1000',
    'Message-ID': '<handover@cedar.example>',
  },
  [
    'Hi office,',
    '',
    'Signed! Owners are Amelia Fiction and her partner - see the lead record.',
    'Site is lot 41 as per the tender. Build period 48 weeks.',
    'Please set the project up today.',
    '',
    'Sam',
  ],
);

const correct = {
  owners: ['Amelia Fiction', 'Leon Sample'],
  builder: 'Cedar Lantern Homes',
  siteLot: '14',
  contractPriceCents: PRICE,
  contractDate: '2026-09-21',
  buildPeriodWeeks: 52,
};
type Facts = typeof correct;
const figures = (facts: Facts) =>
  keyFigures([
    ['Owner 1', facts.owners[0] ?? 'none'],
    ['Owner 2', facts.owners[1] ?? 'none'],
    ['Site lot', facts.siteLot],
    ['Contract price', aud(facts.contractPriceCents)],
    ['Contract date', facts.contractDate],
  ]);
const review = (facts: Facts) =>
  lines(
    '# Contract particulars - Cedar duplex',
    '',
    'Owners come only from the Owner(s) block of the signed contract {{cite:contract|Owner 1:}} {{cite:contract|Owner 2:}}.',
    'Cedar Lantern Homes is the Builder {{cite:contract|Builder: Cedar}}; the witness {{cite:contract|witness:}} and the page footer are not owners.',
    '',
    'Where the documents disagree the signed contract governs:',
    '- the land is Lot 14 {{cite:contract|Land: Lot 14}}, not the tender typo {{cite:tender|Lot 41}} repeated in the handover email {{cite:email|lot 41}};',
    '- the building period is 52 weeks {{cite:contract|Building period}}, not the tender estimate {{cite:tender|48 weeks}}.',
    'The contract price agrees across both documents {{cite:contract|Contract price (incl. GST)}} and the contract is dated 21 September 2026 {{cite:contract|Date of this contract}}.',
    '',
    'Next action: set up the project with these particulars and correct the lot in the handover notes.',
    '',
    figures(facts),
  );

export const contractParticulars = (): DocumentCaseSpec => ({
  id: 'projects/extract-contract-particulars/cedar',
  definitionId: 'D05',
  split: 'development',
  role: 'core',
  profile: 'documents',
  title: 'Extract contract particulars for project setup',
  workType: 'extract',
  instruction: `Sales has handed over the signed Cedar duplex job. Extract the particulars we need to set up the project from the supplied tender, signed contract extract and handover email, applying our precedence and owner rules. Write particulars.json with owners (array of names in contract order), builder, siteLot, contractPriceCents, contractDate (YYYY-MM-DD) and buildPeriodWeeks. Write review.md explaining conflicts and which source governs each. ${DOCUMENT_REPORT_RULES} Labels: Owner 1, Owner 2, Site lot, Contract price, Contract date (YYYY-MM-DD).`,
  entities: ['builder', 'owner-a', 'owner-b', 'lead-a', 'offer-a', 'project-a'],
  scenario:
    'Development signed contract with two individual owners, a tender lot typo and shorter build period, and builder/witness/footer distractors.',
  sources: [
    {
      id: 'tender',
      path: 'documents/tender-revision-3.md',
      mediaType: 'text/markdown',
      content: tender,
    },
    {
      id: 'contract',
      path: 'documents/signed-contract-extract.md',
      mediaType: 'text/markdown',
      content: contract,
    },
    {
      id: 'email',
      path: 'documents/handover-email.eml',
      mediaType: 'message/rfc822',
      content: handover,
    },
  ],
  deliverables: [
    {
      path: 'particulars.json',
      mediaType: 'application/json',
      description: 'Extracted contract particulars',
    },
    {
      path: 'review.md',
      mediaType: 'text/markdown',
      description: 'Cited precedence and conflict review',
    },
  ],
  criteria: [
    {
      kind: 'fact',
      id: 'C1',
      title: 'Both owners from the Owner block, in order, and nobody else',
      severity: 'critical',
      category: 'party',
      deliverable: 'particulars.json',
      pointer: '/owners',
      expected: ['Amelia Fiction', 'Leon Sample'],
      prose: [
        { labels: ['owner 1:'], semantics: 'identifier', expected: 'Amelia Fiction' },
        { labels: ['owner 2:'], semantics: 'identifier', expected: 'Leon Sample' },
      ],
      citations: 'review.md',
      evidence: [
        { source: 'contract', find: 'Owner 1:', fact: 'Owner 1 is Amelia Fiction.' },
        { source: 'contract', find: 'Owner 2:', fact: 'Owner 2 is Leon Sample.' },
        { source: 'contract', find: 'witness:', fact: 'Priya Placeholder is only the witness.' },
      ],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Site lot from the signed contract',
      severity: 'critical',
      category: 'party',
      deliverable: 'particulars.json',
      pointer: '/siteLot',
      expected: '14',
      prose: [{ labels: ['site lot:'], semantics: 'identifier' }],
      evidence: [
        { source: 'contract', find: 'Land: Lot 14', fact: 'Contract land is Lot 14.' },
        { source: 'tender', find: 'Lot 41', fact: 'Tender says Lot 41.' },
        {
          source: 'policy',
          find: 'Use the tender only',
          fact: 'Contract governs shared fields; tender only where silent.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: 'Contract price',
      severity: 'critical',
      category: 'money',
      deliverable: 'particulars.json',
      pointer: '/contractPriceCents',
      expected: PRICE,
      prose: [{ labels: ['contract price:'], semantics: 'cents' }],
      evidence: [
        {
          source: 'contract',
          find: 'Contract price (incl. GST)',
          fact: 'Contract price $664,576.00.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C4',
      title: 'Contract date',
      severity: 'critical',
      category: 'date',
      deliverable: 'particulars.json',
      pointer: '/contractDate',
      expected: '2026-09-21',
      prose: [{ labels: ['contract date:'], semantics: 'date-only' }],
      evidence: [
        { source: 'contract', find: 'Date of this contract', fact: 'Dated 21 September 2026.' },
      ],
    },
    {
      kind: 'fact',
      id: 'C5',
      title: 'Build period from the contract',
      severity: 'substantive',
      category: 'date',
      deliverable: 'particulars.json',
      pointer: '/buildPeriodWeeks',
      expected: 52,
      evidence: [
        { source: 'contract', find: 'Building period', fact: '52 weeks in the contract.' },
        { source: 'tender', find: '48 weeks', fact: '48 weeks in the tender.' },
      ],
    },
    {
      kind: 'fact',
      id: 'C6',
      title: 'Builder recorded separately',
      severity: 'substantive',
      category: 'party',
      deliverable: 'particulars.json',
      pointer: '/builder',
      expected: 'Cedar Lantern Homes',
      evidence: [
        { source: 'contract', find: 'Builder: Cedar', fact: 'Cedar Lantern Homes is the Builder.' },
      ],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Explains precedence and corrects the handover',
      severity: 'substantive',
      category: 'evidence',
      deliverables: ['review.md'],
      evidence: [
        { source: 'email', find: 'lot 41', fact: 'Handover repeats Lot 41 and 48 weeks.' },
        { source: 'contract', find: 'Land: Lot 14', fact: 'Contract land is Lot 14.' },
      ],
      passIf:
        'Explains that the signed contract governs the lot and build period over the tender and handover email, names both conflicts and does not treat the builder, witness or footer as owners.',
      failIf: 'Adopts tender values for a field the contract states, or omits either conflict.',
    },
  ],
  allowedOutcomes: [
    { id: 'particulars-extracted', description: 'Particulars extracted; no project created' },
  ],
  references: [
    { path: 'lib/agent/tender-extraction-prompts.ts' },
    { path: 'lib/domain/projects/owners.ts' },
    { path: 'tests/projects/project-owners.test.ts' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'Contract precedence applied; owners from the Owner block only.',
      failureMode: null,
      files: { 'particulars.json': json(correct), 'review.md': review(correct) },
    },
    (() => {
      const wrong = {
        ...correct,
        owners: ['Amelia Fiction', 'Leon Sample', 'Cedar Lantern Homes'],
      };
      return {
        id: 'builder-as-owner',
        kind: 'negative' as const,
        description: 'Adds the builder from the Builder block and footer as an owner.',
        failureMode: 'wrong-party',
        files: { 'particulars.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C1'] },
      };
    })(),
    (() => {
      const wrong = { ...correct, siteLot: '41', buildPeriodWeeks: 48 };
      return {
        id: 'tender-precedence',
        kind: 'negative' as const,
        description: 'Takes the lot and build period from the tender and handover email.',
        failureMode: 'wrong-identifier',
        files: { 'particulars.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C2', 'C5'] },
      };
    })(),
    (() => {
      const wrong = { ...correct, owners: ['Amelia Fiction'] };
      return {
        id: 'second-owner-dropped',
        kind: 'negative' as const,
        description: 'Uses the enquiry contact from the tender and drops Owner 2.',
        failureMode: 'wrong-party',
        files: { 'particulars.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C1'] },
      };
    })(),
    {
      id: 'wrong-contract-date',
      kind: 'negative',
      description: 'Uses the handover email date as the contract date.',
      failureMode: 'wrong-date',
      files: {
        'particulars.json': json({ ...correct, contractDate: '2026-09-23' }),
        'review.md': review({ ...correct, contractDate: '2026-09-23' }),
      },
      expect: { fail: ['C4'] },
    },
  ],
});
