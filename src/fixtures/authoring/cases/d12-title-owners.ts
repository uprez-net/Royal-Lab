import type { DocumentCaseSpec } from '#fixtures/authoring/types';
import { DOCUMENT_REPORT_RULES, email, json, keyFigures, lines } from '#fixtures/authoring/helpers';

// Development D12: the title search predates settlement and lists the vendors
// as registered proprietors. A caveat names the purchaser, but a caveator is
// not a proprietor, so the any-overlap comparison is a mismatch.
const title = lines(
  '# Title search - fictional register extract',
  '',
  'Folio: 14/DP270114 (fictional)',
  'Search date: 30 August 2026',
  '',
  '## First schedule - registered proprietor',
  '',
  'HARRIET EXAMPLE and GREGORY NOTREAL as joint tenants',
  '',
  '## Second schedule - notifications',
  '',
  '1. Mortgage to Synthetic Mutual Bank (fictional)',
  '2. Caveat by FICTION, Amelia (purchaser) lodged 20 August 2026',
  '',
  'End of search.',
);
const owners = lines(
  '# Project record - Cedar duplex',
  '',
  'Owners recorded from the signed contract (Item 1):',
  '- Amelia Fiction',
  '- Leon Sample',
  '',
  'Land purchase settled: 4 September 2026 (per sales note).',
  'Contract signed: 21 September 2026.',
);
const surveyor = email(
  {
    From: 'Rowan Unreal <survey@level-lines.example>',
    To: 'Office <office@cedar.example>',
    Subject: 'Lot 14 detail survey - title search',
    Date: 'Thu, 01 Oct 2026 12:20:00 +1000',
    'Message-ID': '<title-14@level-lines.example>',
  },
  [
    'Hi,',
    '',
    'For the detail survey I ordered a title search on 30 August (attached as text).',
    'Proprietors per title: Harriet Example and Gregory Notreal.',
    '',
    'Rowan',
  ],
);

const correct = {
  verdict: 'mismatch',
  matchedOwners: [] as string[],
  searchDate: '2026-08-30',
  nextAction: 'fresh-title-search',
};
type Facts = typeof correct;
const figures = (facts: Facts) =>
  keyFigures([
    ['Title owner check', facts.verdict],
    ['Matched owners', facts.matchedOwners.length ? facts.matchedOwners.join(', ') : 'none'],
    ['Search date', facts.searchDate],
  ]);
const review = (facts: Facts) =>
  lines(
    '# Title owner check - Cedar duplex',
    '',
    'The registered proprietors are the vendors {{cite:title|HARRIET EXAMPLE}}; neither matches our recorded owners {{cite:owners|- Amelia Fiction}} {{cite:owners|- Leon Sample}}.',
    'Amelia Fiction appears only as caveator {{cite:title|Caveat by}}, which is not a registered proprietor, so it is not a match.',
    'The search is dated 30 August {{cite:title|Search date}}, before settlement on 4 September {{cite:owners|settled}}, so the register most likely had not been updated.',
    '',
    'Next action: ask the surveyor {{cite:email|ordered a title search}} for a fresh title search before relying on it. The recorded owners are unchanged.',
    '',
    figures(facts),
  );

export const titleOwners = (): DocumentCaseSpec => ({
  id: 'compliance/check-title-owners/cedar',
  definitionId: 'D12',
  split: 'development',
  role: 'core',
  profile: 'documents',
  title: 'Check the title search against the recorded owners',
  workType: 'analyze',
  instruction: `The surveyor has supplied a title search for the Cedar duplex. Compare it with the owners we hold under our title search policy and say what the office should do. Write title-check.json with verdict (match, mismatch or indeterminate), matchedOwners (recorded owners found as registered proprietors), searchDate (YYYY-MM-DD) and nextAction (fresh-title-search, obtain-readable-search or none). Write review.md with your reasoning. ${DOCUMENT_REPORT_RULES} Labels: Title owner check, Matched owners (names, or none), Search date (YYYY-MM-DD).`,
  entities: ['builder', 'owner-a', 'owner-b', 'project-a'],
  scenario:
    'Development title search predating settlement, listing vendors as proprietors, with a purchaser caveat naming a recorded owner.',
  sources: [
    { id: 'title', path: 'documents/title-search.md', mediaType: 'text/markdown', content: title },
    {
      id: 'owners',
      path: 'documents/project-owners.md',
      mediaType: 'text/markdown',
      content: owners,
    },
    {
      id: 'email',
      path: 'documents/surveyor-email.eml',
      mediaType: 'message/rfc822',
      content: surveyor,
    },
  ],
  deliverables: [
    {
      path: 'title-check.json',
      mediaType: 'application/json',
      description: 'Title owner comparison',
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
      title: 'Mismatch: no recorded owner is a proprietor',
      severity: 'critical',
      category: 'decision',
      deliverable: 'title-check.json',
      pointer: '/verdict',
      expected: 'mismatch',
      prose: [{ labels: ['title owner check:'], semantics: 'identifier' }],
      citations: 'review.md',
      evidence: [
        { source: 'title', find: 'HARRIET EXAMPLE', fact: 'Proprietors are the vendors.' },
        { source: 'owners', find: '- Amelia Fiction', fact: 'Recorded owner 1.' },
        { source: 'owners', find: '- Leon Sample', fact: 'Recorded owner 2.' },
      ],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Caveator not counted as a matched owner',
      severity: 'critical',
      category: 'party',
      deliverable: 'title-check.json',
      pointer: '/matchedOwners',
      expected: [],
      prose: [{ labels: ['matched owners:'], semantics: 'identifier', expected: 'none' }],
      evidence: [
        { source: 'title', find: 'Caveat by', fact: 'Amelia Fiction is only a caveator.' },
        {
          source: 'policy',
          find: 'Compare registered proprietors',
          fact: 'Only proprietors are compared.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: 'Search date',
      severity: 'substantive',
      category: 'date',
      deliverable: 'title-check.json',
      pointer: '/searchDate',
      expected: '2026-08-30',
      evidence: [{ source: 'title', find: 'Search date', fact: 'Searched 30 August 2026.' }],
    },
    {
      kind: 'fact',
      id: 'C4',
      title: 'Fresh title search requested',
      severity: 'substantive',
      category: 'decision',
      deliverable: 'title-check.json',
      pointer: '/nextAction',
      expected: 'fresh-title-search',
      evidence: [
        {
          source: 'policy',
          find: 'request a fresh title',
          fact: 'A mismatch warrants a fresh search.',
        },
      ],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Explains settlement lag without altering owners',
      severity: 'substantive',
      category: 'decision',
      deliverables: ['review.md'],
      evidence: [
        { source: 'owners', find: 'settled', fact: 'Settlement 4 September, after the search.' },
        { source: 'title', find: 'Search date', fact: 'Search 30 August.' },
      ],
      passIf:
        'Explains that the search predates settlement, recommends a fresh search from the surveyor and keeps the recorded owners unchanged.',
      failIf:
        'Proposes replacing the owners with the vendors, or treats the caveat as a proprietor match.',
    },
  ],
  allowedOutcomes: [{ id: 'title-checked', description: 'Mismatch reported; owners unchanged' }],
  references: [
    { path: 'lib/domain/compliance/title-search-owners.ts' },
    { path: 'tests/compliance/title-search-owners.test.ts' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'Mismatch with a fresh search requested.',
      failureMode: null,
      files: { 'title-check.json': json(correct), 'review.md': review(correct) },
    },
    (() => {
      const wrong = {
        ...correct,
        verdict: 'match',
        matchedOwners: ['Amelia Fiction'],
        nextAction: 'none',
      };
      return {
        id: 'caveat-match',
        kind: 'negative' as const,
        description: 'Matches the purchaser caveat as if she were a proprietor.',
        failureMode: 'wrong-party',
        files: { 'title-check.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C1', 'C2', 'C4'] },
      };
    })(),
    (() => {
      const wrong = { ...correct, verdict: 'indeterminate', nextAction: 'obtain-readable-search' };
      return {
        id: 'false-indeterminate',
        kind: 'negative' as const,
        description: 'Calls a readable search indeterminate instead of a mismatch.',
        failureMode: 'wrong-decision',
        files: { 'title-check.json': json(wrong), 'review.md': review(wrong) },
        expect: { fail: ['C1', 'C4'] },
      };
    })(),
    {
      id: 'wrong-search-date',
      kind: 'negative',
      description: 'Uses the surveyor email date as the search date.',
      failureMode: 'wrong-date',
      files: {
        'title-check.json': json({ ...correct, searchDate: '2026-10-01' }),
        'review.md': review({ ...correct, searchDate: '2026-10-01' }),
      },
      expect: { fail: ['C3'] },
    },
  ],
});
