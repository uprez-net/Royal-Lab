import type { DocumentCaseSpec } from '#fixtures/authoring/types';
import { DOCUMENT_REPORT_RULES, email, json, keyFigures, lines } from '#fixtures/authoring/helpers';

// Held-out D11: only the latest developer message decides. Earlier messages are
// an acknowledgement and a conditional promise; the latest rejects with a
// reason that must be quoted verbatim. Quoted history repeats the condition.
const REASON =
  'The assessment must rate the northern boundary as BAL-29 and show the 1.8 m radiant heat barrier required by our estate design guidelines.';
const headers = (subject: string, date: string, id: string) => ({
  From: 'Quinn Imaginary <design-review@dune-estate.example>',
  To: 'Office <office@estuary.example>',
  Subject: subject,
  Date: date,
  'Message-ID': `<${id}@dune-estate.example>`,
});
const msg1 = email(headers('Lot 7 bushfire assessment', 'Mon, 21 Sep 2026 10:02:00 +1000', 'ack'), [
  'Hello,',
  '',
  'Thanks, we have received the bushfire assessment for Lot 7.',
  'Our design review usually takes about two weeks.',
  '',
  'Quinn Imaginary, Design Review, Fictional Dune Estate (fictional)',
]);
const msg2 = email(
  headers('RE: Lot 7 bushfire assessment', 'Wed, 30 Sep 2026 14:45:00 +1000', 'conditional'),
  [
    'Hello,',
    '',
    'We would approve it if the BAL rating for the northern boundary were confirmed.',
    'We will come back to you shortly.',
    '',
    'Quinn Imaginary, Design Review',
  ],
);
const msg3 = email(
  headers('RE: Lot 7 bushfire assessment - revised', 'Mon, 05 Oct 2026 16:10:00 +1100', 'decision'),
  [
    'Hello,',
    '',
    'Thank you for the revised bushfire assessment for Lot 7.',
    'Not approved.',
    REASON,
    'Please resubmit once updated.',
    '',
    'Quinn Imaginary, Design Review',
    '',
    '> On 2 Oct 2026, office@estuary.example wrote:',
    '> Could you let us know whether you approve the revised bushfire assessment for Lot 7?',
    '> Earlier you said: We would approve it if the BAL rating were confirmed.',
  ],
);

const correct = { verdict: 'rejected', reason: REASON, decidingMessage: 'msg3' };
type Facts = typeof correct;
const figures = (facts: Facts) =>
  keyFigures([
    ['Verdict', facts.verdict],
    ['Rejection reason', facts.reason || 'none'],
    ['Deciding message', facts.decidingMessage],
  ]);
const review = (facts: Facts) =>
  lines(
    '# Developer verdict - Lot 7 bushfire assessment',
    '',
    'The latest developer message {{cite:msg3|Not approved.}} rejects the revised assessment and states what must change {{cite:msg3|northern boundary as BAL-29}}.',
    'The earlier acknowledgement {{cite:msg1|usually takes}} and the conditional promise {{cite:msg2|We would approve it if}} are not decisions, and the quoted history in the latest message is our own text.',
    '',
    'Next action: send the rejection reason verbatim to the bushfire consultant and resubmit the revised report. No verdict has been recorded in the system by this review.',
    '',
    figures(facts),
  );

export const developerVerdict = (): DocumentCaseSpec => ({
  id: 'compliance/read-developer-verdict/estuary',
  definitionId: 'D11',
  split: 'held-out',
  role: 'core',
  profile: 'documents',
  title: "Read the estate developer's verdict on the bushfire assessment",
  workType: 'extract',
  instruction: `The estate developer has replied several times about the Lot 7 bushfire assessment. Under our developer verdict policy, decide the developer's current verdict so the office can act. Write verdict.json with verdict (approved, rejected or undecided), reason (the developer's stated reason quoted verbatim, or an empty string) and decidingMessage (the source ID of the message that decides it). Write review.md with your reasoning and the next action. ${DOCUMENT_REPORT_RULES} Labels: Verdict, Rejection reason, Deciding message.`,
  entities: ['builder', 'owner-a', 'project-a', 'certifier-a'],
  scenario:
    'Held-out developer thread with an acknowledgement, a conditional promise and a latest rejection whose quoted history repeats the condition.',
  sources: [
    {
      id: 'msg1',
      path: 'documents/developer-msg1.eml',
      mediaType: 'message/rfc822',
      content: msg1,
    },
    {
      id: 'msg2',
      path: 'documents/developer-msg2.eml',
      mediaType: 'message/rfc822',
      content: msg2,
    },
    {
      id: 'msg3',
      path: 'documents/developer-msg3.eml',
      mediaType: 'message/rfc822',
      content: msg3,
    },
  ],
  deliverables: [
    { path: 'verdict.json', mediaType: 'application/json', description: 'Developer verdict facts' },
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
      title: 'Verdict from the latest message',
      severity: 'critical',
      category: 'decision',
      deliverable: 'verdict.json',
      pointer: '/verdict',
      expected: 'rejected',
      prose: [{ labels: ['verdict:'], semantics: 'identifier' }],
      citations: 'review.md',
      evidence: [
        { source: 'msg3', find: 'Not approved.', fact: 'Latest message rejects.' },
        {
          source: 'policy',
          find: 'conditional promise is',
          fact: 'Conditional promises are undecided.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Rejection reason quoted verbatim',
      severity: 'critical',
      category: 'evidence',
      deliverable: 'verdict.json',
      pointer: '/reason',
      expected: REASON,
      prose: [{ labels: ['rejection reason:'], semantics: 'identifier' }],
      evidence: [
        {
          source: 'msg3',
          find: 'northern boundary as BAL-29',
          fact: 'The stated required change.',
        },
        { source: 'policy', find: 'verbatim', fact: 'Quote a rejection reason verbatim.' },
      ],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: 'Deciding message identified',
      severity: 'substantive',
      category: 'evidence',
      deliverable: 'verdict.json',
      pointer: '/decidingMessage',
      expected: 'msg3',
      evidence: [
        { source: 'msg3', find: 'Not approved.', fact: 'msg3 is the latest developer message.' },
      ],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Ignores acknowledgement, condition and quoted history',
      severity: 'substantive',
      category: 'decision',
      deliverables: ['review.md'],
      evidence: [
        { source: 'msg2', find: 'We would approve it if', fact: 'Conditional promise.' },
        { source: 'msg3', find: 'Earlier you said', fact: 'Quoted history repeats the condition.' },
      ],
      passIf:
        'Explains that the acknowledgement, conditional promise and quoted history are not decisions, and recommends sending the verbatim reason to the consultant without claiming a verdict was recorded.',
      failIf:
        'Treats the condition as approval, paraphrases the reason as the thing to send, or claims the verdict was recorded or sent.',
    },
  ],
  allowedOutcomes: [
    { id: 'verdict-read', description: 'Verdict determined; nothing recorded or sent' },
  ],
  references: [
    { path: 'lib/agent/developerApprovalAgent.ts' },
    { path: 'tests/compliance/development-approval.test.ts' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'Rejected, verbatim reason from msg3.',
      failureMode: null,
      files: { 'verdict.json': json(correct), 'review.md': review(correct) },
    },
    (() => {
      const wrong = { verdict: 'approved', reason: '', decidingMessage: 'msg2' };
      return {
        id: 'conditional-approval',
        kind: 'negative' as const,
        description: 'Treats the conditional promise as approval.',
        failureMode: 'wrong-decision',
        files: { 'verdict.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C1', 'C2', 'C3'] },
      };
    })(),
    (() => {
      const wrong = {
        ...correct,
        reason: 'They want the north side upgraded to BAL-29 and a heat barrier added.',
      };
      return {
        id: 'paraphrased-reason',
        kind: 'negative' as const,
        description: 'Correct verdict but a paraphrased reason.',
        failureMode: 'wrong-identifier',
        files: { 'verdict.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C2'] },
      };
    })(),
    (() => {
      const wrong = { verdict: 'undecided', reason: '', decidingMessage: 'msg1' };
      return {
        id: 'acknowledgement-read',
        kind: 'negative' as const,
        description: 'Reads the first acknowledgement instead of the latest message.',
        failureMode: 'wrong-decision',
        files: { 'verdict.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C1', 'C2', 'C3'] },
      };
    })(),
  ],
});
