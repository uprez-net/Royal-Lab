import type { DocumentCaseSpec } from '#fixtures/authoring/types';
import { DOCUMENT_REPORT_RULES, email, json, keyFigures, lines } from '#fixtures/authoring/helpers';

// Development D10: six documents for the Cedar duplex (Lot 14). The portal
// email is not a certificate, the only issued CDC is for Lot 41, and a page
// without its title block cannot be classified.
const SITE = '18 Imaginary Cedar Circuit, Synthetic Township NSW (fictional)';
const proposal = lines(
  '# North Star Synthetic Certification (fictional) - Fee proposal NS-FP-0931',
  '',
  `Property: Lot 14, ${SITE}`,
  'Scope of services: complying development certificate assessment and mandatory inspections.',
  'Proposed fee (incl. GST): $6,820.00',
  'This proposal is valid for 30 days. To accept, sign and return this page.',
  'Accepted by: ____________________  Date: __________',
);
const invoice = lines(
  '# North Star Synthetic Certification (fictional) - TAX INVOICE NS-INV-4410',
  '',
  `Property: Lot 14, ${SITE}`,
  'Invoice date: 28 September 2026. Due date: 12 October 2026.',
  'Description: CDC assessment - stage 1 fee',
  'Amount payable (incl. GST): $3,410.00',
  'Pay to: Synthetic Bank, account name North Star Synthetic Certification.',
);
const form = lines(
  '# Application for a complying development certificate (fictional form)',
  '',
  'Part 1 - Applicant: Cedar Lantern Homes (fictional)',
  `Part 2 - Land: Lot 14, ${SITE}`,
  'Part 3 - Description of development: two-dwelling duplex',
  "Part 4 - Owner's consent: signed Amelia Fiction, signed Leon Sample",
  'Part 5 - Declaration: I declare the information in this application is true.',
);
const portal = email(
  {
    From: 'Planning Portal (fictional) <no-reply@portal.example>',
    To: 'Office <office@cedar.example>',
    Subject: 'Certificate CDC-2026-0412 is ready to download',
    Date: 'Fri, 02 Oct 2026 09:30:00 +1000',
    'Message-ID': '<cdc-ready@portal.example>',
  },
  [
    'A complying development certificate CDC-2026-0412 is ready to download.',
    'Log in to the portal to view and download the certificate and approved plans.',
    'This email is an automated notification only.',
  ],
);
const issued = lines(
  '# Complying Development Certificate CDC-2026-0412 (fictional)',
  '',
  `Land: Lot 41, ${SITE}`,
  'Certifier: Avery Inventa, registration RC-0091 (fictional)',
  'Date of determination: 1 October 2026',
  'Approved plans: Schedule 1, drawings DA-01 to DA-12',
  'Conditions: see Schedule 2.',
);
const partial = lines(
  '# [page 2 of 3 - first page not supplied]',
  '',
  'Schedule 2 - Conditions (continued)',
  '12. Erosion and sediment controls are to be maintained until completion.',
  '13. All works are to be carried out between 7 am and 5 pm Monday to Friday.',
);

type Type =
  'FEE_PROPOSAL' | 'INVOICE' | 'CDC_FORM' | 'COMPLYING_DEVELOPMENT_CERTIFICATE' | 'UNKNOWN';
const correct = {
  documents: {
    doc1: 'FEE_PROPOSAL',
    doc2: 'INVOICE',
    doc3: 'CDC_FORM',
    doc4: 'UNKNOWN',
    doc5: 'COMPLYING_DEVELOPMENT_CERTIFICATE',
    doc6: 'UNKNOWN',
  } as Record<string, Type>,
  cdcIssuedForSite: false,
};
type Facts = typeof correct;
const figures = (facts: Facts) =>
  keyFigures([
    ...Object.entries(facts.documents).map(([id, type]): [string, string] => [`${id} type`, type]),
    ['CDC in hand for Lot 14', facts.cdcIssuedForSite ? 'true' : 'no'],
  ]);
const review = (facts: Facts) =>
  lines(
    '# Certifier document classification - Cedar duplex (Lot 14)',
    '',
    'doc1 offers future work and asks to be accepted {{cite:doc1|To accept}}; doc2 demands payment now with a due date {{cite:doc2|Amount payable}}.',
    'doc3 is the application form with owner consent and a declaration {{cite:doc3|Declaration}}, not an issued certificate.',
    'doc4 is a portal notification {{cite:doc4|automated notification}}; the certificate itself is not in the pack.',
    'doc5 is an issued CDC, but for Lot 41 {{cite:doc5|Land: Lot 41}}, not our Lot 14.',
    'doc6 has no title block {{cite:doc6|first page not supplied}}, so its type cannot be stated.',
    '',
    'Next action: download the certificate referred to in the portal email, confirm its lot against Lot 14 and query the certifier about the Lot 41 determination before any checklist gate is cleared.',
    '',
    figures(facts),
  );

export const certifierDocument = (): DocumentCaseSpec => ({
  id: 'compliance/classify-certifier-document/cedar',
  definitionId: 'D10',
  split: 'development',
  role: 'core',
  profile: 'documents',
  title: 'Classify the certifier documents received for the duplex',
  workType: 'extract',
  instruction: `Six documents have arrived for the Cedar duplex compliance file (Lot 14). Classify each under our certifier document policy and decide whether we now hold an issued complying development certificate for this site. Write classification.json with documents (an object mapping each source ID doc1 to doc6 to one type from the policy list) and cdcIssuedForSite. Write review.md with your reasoning and next action. ${DOCUMENT_REPORT_RULES} Labels: doc1 type, doc2 type, doc3 type, doc4 type, doc5 type, doc6 type, CDC in hand for Lot 14 (yes or no).`,
  entities: ['builder', 'owner-a', 'owner-b', 'project-a', 'certifier-a'],
  scenario:
    'Development certifier pack with a fee proposal, invoice, application form, portal notification, an issued CDC for a neighbouring lot and a headless page.',
  sources: [
    {
      id: 'doc1',
      path: 'documents/doc1-fee-proposal.md',
      mediaType: 'text/markdown',
      content: proposal,
    },
    {
      id: 'doc2',
      path: 'documents/doc2-tax-invoice.md',
      mediaType: 'text/markdown',
      content: invoice,
    },
    {
      id: 'doc3',
      path: 'documents/doc3-application.md',
      mediaType: 'text/markdown',
      content: form,
    },
    {
      id: 'doc4',
      path: 'documents/doc4-portal-email.eml',
      mediaType: 'message/rfc822',
      content: portal,
    },
    {
      id: 'doc5',
      path: 'documents/doc5-certificate.md',
      mediaType: 'text/markdown',
      content: issued,
    },
    {
      id: 'doc6',
      path: 'documents/doc6-page-two.md',
      mediaType: 'text/markdown',
      content: partial,
    },
  ],
  deliverables: [
    {
      path: 'classification.json',
      mediaType: 'application/json',
      description: 'Document types and CDC decision',
    },
    {
      path: 'review.md',
      mediaType: 'text/markdown',
      description: 'Cited reasoning and next action',
    },
  ],
  criteria: [
    {
      kind: 'fact',
      id: 'C1',
      title: 'Fee proposal recognized',
      severity: 'substantive',
      category: 'decision',
      deliverable: 'classification.json',
      pointer: '/documents/doc1',
      expected: 'FEE_PROPOSAL',
      evidence: [{ source: 'doc1', find: 'To accept', fact: 'Offers future work for acceptance.' }],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Invoice recognized',
      severity: 'substantive',
      category: 'decision',
      deliverable: 'classification.json',
      pointer: '/documents/doc2',
      expected: 'INVOICE',
      evidence: [
        { source: 'doc2', find: 'Amount payable', fact: 'Amount payable now with a due date.' },
      ],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: 'Application form is not a certificate',
      severity: 'critical',
      category: 'decision',
      deliverable: 'classification.json',
      pointer: '/documents/doc3',
      expected: 'CDC_FORM',
      prose: [{ labels: ['doc3 type:'], semantics: 'identifier' }],
      citations: 'review.md',
      evidence: [
        { source: 'doc3', find: 'Declaration', fact: 'Applicant declaration and owner consent.' },
      ],
    },
    {
      kind: 'fact',
      id: 'C4',
      title: 'Portal notification is not a certificate',
      severity: 'critical',
      category: 'decision',
      deliverable: 'classification.json',
      pointer: '/documents/doc4',
      expected: 'UNKNOWN',
      prose: [{ labels: ['doc4 type:'], semantics: 'identifier' }],
      evidence: [
        { source: 'doc4', find: 'automated notification', fact: 'Automated notification only.' },
        {
          source: 'policy',
          find: 'portal',
          fact: 'A portal notification is not an issued certificate.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C5',
      title: 'Issued CDC recognized by type',
      severity: 'substantive',
      category: 'decision',
      deliverable: 'classification.json',
      pointer: '/documents/doc5',
      expected: 'COMPLYING_DEVELOPMENT_CERTIFICATE',
      evidence: [
        {
          source: 'doc5',
          find: 'Date of determination',
          fact: 'Determined certificate with certifier.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C6',
      title: 'Headless page left UNKNOWN',
      severity: 'critical',
      category: 'decision',
      deliverable: 'classification.json',
      pointer: '/documents/doc6',
      expected: 'UNKNOWN',
      prose: [{ labels: ['doc6 type:'], semantics: 'identifier' }],
      evidence: [{ source: 'doc6', find: 'first page not supplied', fact: 'Title block missing.' }],
    },
    {
      kind: 'fact',
      id: 'C7',
      title: 'No issued CDC held for this site',
      severity: 'critical',
      category: 'evidence',
      deliverable: 'classification.json',
      pointer: '/cdcIssuedForSite',
      expected: false,
      prose: [{ labels: ['cdc in hand for lot 14:'], semantics: 'boolean' }],
      evidence: [
        { source: 'doc5', find: 'Land: Lot 41', fact: 'The issued CDC is for Lot 41.' },
        {
          source: 'policy',
          find: 'different lot',
          fact: 'A certificate for another lot is not evidence for this site.',
        },
      ],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Grounded next action without clearing the gate',
      severity: 'substantive',
      category: 'decision',
      deliverables: ['review.md'],
      evidence: [
        {
          source: 'doc4',
          find: 'Log in to the portal',
          fact: 'The certificate may be on the portal.',
        },
        { source: 'doc5', find: 'Land: Lot 41', fact: 'Lot mismatch.' },
      ],
      passIf:
        'Recommends obtaining the referenced certificate and checking it against Lot 14 and querying the Lot 41 determination, without treating the CDC requirement as satisfied.',
      failIf: 'Treats the CDC requirement as satisfied, or ignores the lot mismatch.',
    },
  ],
  allowedOutcomes: [
    { id: 'classified', description: 'Documents classified; no checklist gate cleared' },
  ],
  references: [
    { path: 'lib/agent/document-classifier-prompts.ts' },
    { path: 'tests/compliance/portal-certificates.test.ts' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'Correct types; notification and headless page UNKNOWN; no CDC for Lot 14.',
      failureMode: null,
      files: { 'classification.json': json(correct), 'review.md': review(correct) },
    },
    (() => {
      const wrong = {
        documents: { ...correct.documents, doc4: 'COMPLYING_DEVELOPMENT_CERTIFICATE' as Type },
        cdcIssuedForSite: true,
      };
      return {
        id: 'notification-as-certificate',
        kind: 'negative' as const,
        description: 'Treats the portal email as the issued certificate.',
        failureMode: 'wrong-decision',
        files: { 'classification.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C4', 'C7'] },
      };
    })(),
    (() => {
      const wrong = { ...correct, cdcIssuedForSite: true };
      return {
        id: 'wrong-lot-accepted',
        kind: 'negative' as const,
        description: 'Accepts the Lot 41 certificate as evidence for Lot 14.',
        failureMode: 'wrong-decision',
        files: { 'classification.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C7'] },
      };
    })(),
    (() => {
      const wrong = {
        ...correct,
        documents: { ...correct.documents, doc1: 'INVOICE' as Type, doc2: 'FEE_PROPOSAL' as Type },
      };
      return {
        id: 'proposal-invoice-swap',
        kind: 'negative' as const,
        description: 'Swaps the fee proposal and the invoice.',
        failureMode: 'wrong-decision',
        files: { 'classification.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C1', 'C2'] },
      };
    })(),
    (() => {
      const wrong = {
        ...correct,
        documents: { ...correct.documents, doc6: 'COMPLYING_DEVELOPMENT_CERTIFICATE' as Type },
      };
      return {
        id: 'guessed-headless-page',
        kind: 'negative' as const,
        description: 'Guesses the headless conditions page is a certificate.',
        failureMode: 'wrong-decision',
        files: { 'classification.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C6'] },
      };
    })(),
  ],
});
