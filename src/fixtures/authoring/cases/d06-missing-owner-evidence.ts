import type { DocumentCaseSpec } from '#fixtures/authoring/types';
import { aud, DOCUMENT_REPORT_RULES, json, keyFigures, lines } from '#fixtures/authoring/helpers';

// Held-out D06: the Estuary extension contract extract refers to Annexure A for
// owner details, but the annexure is not supplied. Owners must stay empty.
const PRICE = 18645000;
const contract = lines(
  '# Residential building contract - extract, pages 3 to 6 of 14 (fictional form)',
  '',
  'Project: Estuary extension recovery, 72 Fictional Estuary Lane, Synthetic Township NSW (fictional)',
  '',
  '## Item 1 - Owner(s)',
  '',
  'The Owner is the party described in Annexure A (Owner details).',
  '',
  '## Item 2 - Builder',
  '',
  'Builder: Estuary Workshop Builders, contractor licence EW-40731 (fictional), office@estuary.example',
  '',
  '## Item 4 - Contract price',
  '',
  `Contract price (incl. GST): ${aud(PRICE)}`,
  '',
  '## Execution page',
  '',
  'Signed by the Owner: [handwritten signature, name not printed]',
  'Witness: Marcus Mockwell, 9 Invented Parade, Synthetic Township NSW (fictional)',
  'Signed for the Builder: Jordan Fakename, Director, Estuary Workshop Builders',
  '',
  'Annexure A (Owner details) - page 13 - not included in this extract.',
  '',
  '---',
  'Estuary Workshop Builders | office@estuary.example | contract extract',
);
const lead = lines(
  '# CRM lead record - Coastal delayed extension',
  '',
  '- Enquirer: Ravi Pretend, ravi@coastal-enquiry.example',
  '- Enquiry note: calling on behalf of Invented Coastal Trust (unverified)',
  '- Stage: WON',
  '- Assigned: Estuary Workshop Builders office',
);
const tender = lines(
  '# Tender cover letter - extension recovery works',
  '',
  'Prepared for: Ravi Pretend, on behalf of the owner',
  'Builder: Estuary Workshop Builders (fictional)',
  '',
  'This tender is subject to the signed contract and its annexures.',
);

const correct = {
  owners: [] as string[],
  ownerBlockPresent: false,
  requestedSource: 'Annexure A',
  contractPriceCents: PRICE,
};
type Facts = typeof correct;
const figures = (facts: Facts) =>
  keyFigures([
    ['Owners extracted', facts.owners.length ? facts.owners.join(', ') : 'none'],
    ['Owner block present', facts.ownerBlockPresent ? 'true' : 'no'],
    ['Requested source', facts.requestedSource],
  ]);
const review = (facts: Facts) =>
  lines(
    '# Owner evidence check - Estuary extension recovery',
    '',
    'Item 1 refers to Annexure A for the owner {{cite:contract|described in Annexure A}}, and the annexure is not in this extract {{cite:contract|not included in this extract}}.',
    'No owner can be taken from the signature page {{cite:contract|Signed by the Owner}}, the witness {{cite:contract|Witness:}}, the builder footer, the lead enquirer {{cite:lead|Enquirer}} or the unverified trust note {{cite:lead|unverified}}.',
    `The contract price ${aud(PRICE)} {{cite:contract|Contract price (incl. GST)}} can still be recorded.`,
    '',
    'Next action: send the focused request in evidence-request.md before creating customers or Xero contacts.',
    '',
    figures(facts),
  );
const request = lines(
  '# Evidence request',
  '',
  'To: contracts administrator, Estuary Workshop Builders',
  '',
  'Please provide Annexure A (Owner details), page 13 of the signed residential building contract for the Estuary extension recovery job at 72 Fictional Estuary Lane.',
  'We need every party named as Owner exactly as printed, with their address and contact details, before the project and customer records are created.',
);

export const missingOwnerEvidence = (): DocumentCaseSpec => ({
  id: 'projects/handle-missing-owner-evidence/estuary',
  definitionId: 'D06',
  split: 'held-out',
  role: 'core',
  profile: 'documents',
  title: 'Set up owners from a contract extract that lacks the Owner block',
  workType: 'extract',
  instruction: `The office needs the owners for the Estuary extension recovery job so the customer records can be created. Use only the supplied contract extract, lead record and tender cover under our owner rules. Write particulars.json with owners (array; empty if not evidenced), ownerBlockPresent, requestedSource (the exact missing document or annexure, or null) and contractPriceCents. Write evidence-request.md with any focused request for missing evidence, and review.md explaining your decision. ${DOCUMENT_REPORT_RULES} Labels: Owners extracted (names, or none), Owner block present (yes or no), Requested source.`,
  entities: ['builder', 'owner-a', 'lead-b', 'offer-b', 'project-b', 'document-a'],
  scenario:
    'Held-out contract extract whose Owner block is in a missing annexure, with signature page, witness, footer and lead-record temptations.',
  sources: [
    {
      id: 'contract',
      path: 'documents/contract-extract-pages-3-6.md',
      mediaType: 'text/markdown',
      content: contract,
    },
    { id: 'lead', path: 'documents/lead-record.md', mediaType: 'text/markdown', content: lead },
    {
      id: 'tender',
      path: 'documents/tender-cover.md',
      mediaType: 'text/markdown',
      content: tender,
    },
  ],
  deliverables: [
    {
      path: 'particulars.json',
      mediaType: 'application/json',
      description: 'Owner evidence facts',
    },
    {
      path: 'evidence-request.md',
      mediaType: 'text/markdown',
      description: 'Focused request for missing evidence',
    },
    { path: 'review.md', mediaType: 'text/markdown', description: 'Cited decision' },
  ],
  criteria: [
    {
      kind: 'fact',
      id: 'C1',
      title: 'Owners left empty without the Owner block',
      severity: 'critical',
      category: 'party',
      deliverable: 'particulars.json',
      pointer: '/owners',
      expected: [],
      prose: [{ labels: ['owners extracted:'], semantics: 'identifier', expected: 'none' }],
      citations: 'review.md',
      evidence: [
        {
          source: 'contract',
          find: 'described in Annexure A',
          fact: 'Owner details are in Annexure A.',
        },
        {
          source: 'contract',
          find: 'not included in this extract',
          fact: 'Annexure A is not supplied.',
        },
        {
          source: 'policy',
          find: 'owners are an empty list',
          fact: 'No Owner block means no owners.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Owner block reported absent',
      severity: 'critical',
      category: 'evidence',
      deliverable: 'particulars.json',
      pointer: '/ownerBlockPresent',
      expected: false,
      prose: [{ labels: ['owner block present:'], semantics: 'boolean' }],
      evidence: [
        {
          source: 'contract',
          find: 'described in Annexure A',
          fact: 'Item 1 only points to the annexure.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: 'Requests the exact missing annexure',
      severity: 'substantive',
      category: 'evidence',
      deliverable: 'particulars.json',
      pointer: '/requestedSource',
      expected: 'Annexure A',
      evidence: [
        {
          source: 'contract',
          find: 'not included in this extract',
          fact: 'Annexure A page 13 is missing.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C4',
      title: 'Contract price still extracted',
      severity: 'substantive',
      category: 'money',
      deliverable: 'particulars.json',
      pointer: '/contractPriceCents',
      expected: PRICE,
      evidence: [
        {
          source: 'contract',
          find: 'Contract price (incl. GST)',
          fact: 'Contract price $186,450.00.',
        },
      ],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Focused evidence request',
      severity: 'substantive',
      category: 'evidence',
      deliverables: ['evidence-request.md'],
      evidence: [
        {
          source: 'contract',
          find: 'not included in this extract',
          fact: 'Annexure A is missing.',
        },
      ],
      passIf:
        'Requests Annexure A (Owner details) of the signed contract for this job specifically and explains what is needed from it.',
      failIf:
        'Makes a generic request, asks the wrong party for unrelated documents, or assumes the owners.',
    },
    {
      kind: 'semantic',
      id: 'S2',
      title: 'Does not build owners from other cues',
      severity: 'substantive',
      category: 'party',
      deliverables: ['review.md'],
      evidence: [
        { source: 'contract', find: 'Witness:', fact: 'Marcus Mockwell is the witness.' },
        {
          source: 'lead',
          find: 'unverified',
          fact: 'The trust is only an unverified enquiry note.',
        },
        { source: 'tender', find: 'Prepared for', fact: 'The enquirer is not an owner.' },
      ],
      passIf:
        'Explains that the signature page, witness, builder details, enquirer and unverified trust note cannot establish owners.',
      failIf: 'Suggests or records any of those parties as owner, even provisionally.',
    },
  ],
  allowedOutcomes: [
    { id: 'evidence-requested', description: 'Owners left empty and annexure requested' },
  ],
  references: [
    { path: 'lib/agent/tender-extraction-prompts.ts' },
    { path: 'tests/projects/project-owners.test.ts' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'Owners empty, annexure requested, price recorded.',
      failureMode: null,
      files: {
        'particulars.json': json(correct),
        'evidence-request.md': request,
        'review.md': review(correct),
      },
    },
    (() => {
      const wrong = { ...correct, owners: ['Invented Coastal Trust'] };
      return {
        id: 'trust-from-lead',
        kind: 'negative' as const,
        description: 'Records the unverified trust from the lead note as the owner.',
        failureMode: 'invented-value',
        files: {
          'particulars.json': json(wrong),
          'evidence-request.md': request,
          'review.md': review(wrong),
        },
        expect: { fail: ['C1'] },
      };
    })(),
    (() => {
      const wrong = {
        ...correct,
        owners: ['Marcus Mockwell'],
        ownerBlockPresent: true,
        requestedSource: null,
      };
      return {
        id: 'witness-as-owner',
        kind: 'negative' as const,
        description: 'Treats the execution page witness as the owner.',
        failureMode: 'wrong-party',
        files: {
          'particulars.json': json(wrong),
          'evidence-request.md': request,
          'review.md': review(wrong as unknown as Facts),
        },
        expect: { fail: ['C1', 'C2', 'C3'] },
      };
    })(),
    (() => {
      const wrong = { ...correct, owners: ['Estuary Workshop Builders'] };
      return {
        id: 'builder-as-owner',
        kind: 'negative' as const,
        description: 'Takes the builder from the footer and Builder block as the owner.',
        failureMode: 'wrong-party',
        files: {
          'particulars.json': json(wrong),
          'evidence-request.md': request,
          'review.md': review(wrong),
        },
        expect: { fail: ['C1'] },
      };
    })(),
  ],
});
