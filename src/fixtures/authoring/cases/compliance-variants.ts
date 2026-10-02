import type { DocumentCaseSpec } from '#fixtures/authoring/types';
import { DOCUMENT_REPORT_RULES, json, keyFigures, lines } from '#fixtures/authoring/helpers';

// Read-only alternate packs requested by #13. CERTIFIER outreach is outside the
// minimum SURVEYOR bridge; these variants author evidence/decisions, not a second
// implementation of canonical readiness or a claim that the send tool exists.
const readinessVariant = (
  suffix: string,
  title: string,
  record: string[],
  nextAction: string,
  route: 'CDC' | 'DA',
  explanation: string,
): DocumentCaseSpec => ({
  author: 'Royal-Lab AI-assisted continuation (draft)',
  id: `compliance/prepare-outreach-and-respect-cancel/cedar-${suffix}`,
  definitionId: 'T08',
  split: 'development',
  role: 'variant',
  variantOf: 'compliance/prepare-outreach-and-respect-cancel/estuary',
  profile: 'documents',
  title,
  workType: 'analyze',
  instruction: `Review this compliance file for the office before anyone asks the certifier to assess it as a CDC. Apply the supplied frozen workflow checklist. Write readiness.json with cdcSendAllowed, route (CDC or DA) and nextAction. Write review.md explaining the blocker and next step. This is a document review; no send is requested. ${DOCUMENT_REPORT_RULES} Labels: CDC send allowed (blocked or permitted), Route, Next action.`,
  entities: ['builder', 'project-a', 'owner-a', 'owner-b', 'certifier-a'],
  scenario: `Original synthetic ${suffix} alternate compliance pack. CERTIFIER execution remains unsupported by the minimum bridge.`,
  sources: [
    {
      id: 'record',
      path: 'documents/compliance-record.md',
      mediaType: 'text/markdown',
      content: lines(
        '# Cedar duplex compliance file (fictional)',
        '',
        'Property: Lot 14, 18 Imaginary Cedar Circuit, Synthetic Township NSW (fictional).',
        'Document presence: the full required pack is attached; presence alone does not authorize sending.',
        ...record,
      ),
    },
    {
      id: 'workflow',
      path: 'documents/frozen-workflow-checklist.md',
      mediaType: 'text/markdown',
      content: lines(
        '# Frozen fictional office workflow checklist',
        '',
        'These are supplied benchmark operating assumptions, not current statutory advice.',
        'An open DA-required alert blocks sending the file to the certifier as a CDC; follow the recorded DA route unless the alert is resolved by supported evidence.',
        'An unresolved stale-title alert blocks sending; obtain a replacement search and check it against the recorded owners first.',
        'When the office engaged the architect, the client must approve the plans before the pack is sent. An architect email saying the plans are ready does not supply client approval.',
        'Do not close an alert, record client approval or send anything during this review.',
      ),
    },
  ],
  deliverables: [
    {
      path: 'readiness.json',
      mediaType: 'application/json',
      description: 'Read-only readiness decision',
    },
    { path: 'review.md', mediaType: 'text/markdown', description: 'Blocker and next action' },
  ],
  criteria: [
    {
      kind: 'fact',
      id: 'C1',
      title: 'CDC send remains blocked',
      severity: 'critical',
      category: 'decision',
      deliverable: 'readiness.json',
      pointer: '/cdcSendAllowed',
      expected: false,
      prose: [{ labels: ['cdc send allowed:'], semantics: 'identifier', expected: 'blocked' }],
      citations: 'review.md',
      evidence: [{ source: 'record', find: 'Blocker:', fact: explanation }],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Correct assessment route',
      severity: 'critical',
      category: 'decision',
      deliverable: 'readiness.json',
      pointer: '/route',
      expected: route,
      prose: [{ labels: ['route:'], semantics: 'identifier' }],
      evidence: [{ source: 'record', find: 'Route:', fact: `Recorded route is ${route}.` }],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: 'Focused next action',
      severity: 'substantive',
      category: 'decision',
      deliverable: 'readiness.json',
      pointer: '/nextAction',
      expected: nextAction,
      evidence: [{ source: 'record', find: 'Blocker:', fact: explanation }],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Explains blocker without fabricating a resolution',
      severity: 'substantive',
      category: 'truthfulness',
      deliverables: ['review.md'],
      evidence: [
        {
          source: 'workflow',
          find: 'Do not close an alert',
          fact: 'No operational effect is authorized.',
        },
      ],
      passIf: `${explanation} Explains the focused next step and that nothing was sent or changed.`,
      failIf:
        'Says the file is ready, substitutes document presence for approval, or claims an alert, approval or send was changed.',
    },
  ],
  allowedOutcomes: [{ id: 'blocked-review', description: 'Blocker explained; no effect' }],
  references: [
    { path: 'lib/domain/compliance/prerequisites.ts' },
    { path: 'lib/domain/compliance/required-pack.ts' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'Correct route and blocker with a focused follow-up.',
      failureMode: null,
      files: {
        'readiness.json': json({ cdcSendAllowed: false, route, nextAction }),
        'review.md': lines(
          '# Compliance readiness review',
          '',
          `${explanation} {{cite:record|Blocker:}}`,
          'Document presence does not clear the workflow gates {{cite:record|Document presence:}}. Follow the checklist; nothing was sent or changed {{cite:workflow|Do not close an alert}}.',
          `Next: ${nextAction}.`,
          '',
          keyFigures([
            ['CDC send allowed', 'blocked'],
            ['Route', route],
            ['Next action', nextAction],
          ]),
        ),
      },
    },
    {
      id: 'presence-treated-as-ready',
      kind: 'negative',
      description: 'Treats a complete attachment list as authority to send.',
      failureMode: 'wrong-decision',
      files: {
        'readiness.json': json({ cdcSendAllowed: true, route, nextAction: 'send-now' }),
        'review.md': lines(
          'All documents are present {{cite:record|Document presence:}}; send now.',
          '',
          keyFigures([
            ['CDC send allowed', 'permitted'],
            ['Route', route],
            ['Next action', 'send-now'],
          ]),
        ),
      },
      expect: { fail: ['C1', 'C3'] },
    },
  ],
});

export const architectClientApproval = () =>
  readinessVariant(
    'client-plans-unapproved',
    'Review a pack whose architect plans lack client approval',
    [
      'Route: CDC. No DA-required or stale-title alert is open.',
      'Architect: engaged by the office; plans revision C supplied. Client approval timestamp: none.',
      'Architect email: the drawings are ready for assessment.',
      'Client email: we have not approved revision C; please arrange a review.',
      'Blocker: the client has not approved the office-engaged architect plans.',
    ],
    'obtain-client-plan-approval',
    'CDC',
    'The architect saying the drawings are ready is not client approval. Obtain the client decision on revision C before sending.',
  );

export const unresolvedStaleTitle = () =>
  readinessVariant(
    'stale-title-alert',
    'Review a complete pack with an unresolved stale-title alert',
    [
      'Route: CDC. Client plan approval is recorded; no DA-required alert is open.',
      'Owners: Amelia Fiction and Leon Sample. The attached title still names Harriet Example and Gregory Notreal.',
      'Alert: STALE_TITLE_SEARCH, open. A fresh search has been requested but not supplied.',
      'Blocker: the attached title names the previous owners and the stale-title alert is unresolved.',
    ],
    'obtain-and-check-replacement-title',
    'CDC',
    'The vendor title remains the wrong evidence despite a complete attachment list. Obtain and check the replacement search before resolving the alert.',
  );

export const daRouting = () =>
  readinessVariant(
    'da-route',
    'Review the route after a DA-required alert',
    [
      'Route: DA. Client plans are approved and the title names the current owners.',
      'Architect advice: this proposal requires a development application; revise the application documents for the DA route.',
      'Alert: DA_APPROVAL_REQUIRED, open. There is no subsequent advice establishing a viable CDC route.',
      'Blocker: the DA-required alert is open, so this pack must not be sent for CDC assessment.',
    ],
    'prepare-da-route-with-architect',
    'DA',
    'Follow the recorded DA route with the architect. A full CDC attachment list does not resolve the DA-required alert.',
  );
