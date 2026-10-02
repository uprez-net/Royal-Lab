import type { DocumentCaseSpec, Json } from '#fixtures/authoring/types';
import { DOCUMENT_REPORT_RULES, email, json, keyFigures, lines } from '#fixtures/authoring/helpers';

// Held-out D09: lettered children are items; a restarted 1-3 list under 4a is
// 4a's requirements; a trailing note belongs to item 3; a status cell is not
// part of a label; header, heading and submission instructions are not items.
const checklist = lines(
  '# Estuary Synthetic Certification (fictional) - Document checklist',
  '',
  '| Our ref | ESC-CDC-2611 |',
  '| Property | Lot 7, 72 Fictional Estuary Lane, Synthetic Township NSW (fictional) |',
  '| Scope | Two-storey dwelling - complying development |',
  '| From | Avery Inventa, registered certifier (fictional) |',
  '| Date | 2 October 2026 |',
  '',
  '## Prior to assessment',
  '',
  '1. Detail and level survey of the site',
  '2. Section 10.7 planning certificate (2) and (5)',
  '3. BASIX certificate',
  '4. Design documentation',
  '',
  '# a. Architectural plans',
  '',
  'Architect plans need to be amended as per following:',
  '1. Show the 900 mm setback to the eastern boundary on sheet A-02.',
  '2. Add the finished floor level RL 12.450 to the ground floor plan.',
  '3. Dimension the garage door opening.',
  '',
  'b. Structural engineering plans',
  'c. Stormwater drainage plan',
  '   - Designed to AS/NZS 3500.3:2021',
  '   - Show the on-site detention tank volume',
  '',
  '5. Home Building Compensation Fund certificate | Received',
  '6. Long service levy',
  '   Receipt of payment of the levy to the Long Service Corporation (fictional) for the full construction cost.',
  '',
  'Item 3 - BASIX commitments must match the amended architectural plans.',
  '',
  'Assessment will not commence until all items are submitted. Email documents to cert@estuary-cert.example.',
);
const coverEmail = email(
  {
    From: 'Avery Inventa <cert@estuary-cert.example>',
    To: 'Office <office@estuary.example>',
    Subject: 'ESC-CDC-2611 - checklist for Lot 7',
    Date: 'Fri, 02 Oct 2026 11:05:00 +1000',
    'Message-ID': '<checklist-2611@estuary-cert.example>',
  },
  [
    'Hello,',
    '',
    'Please find our document checklist for Lot 7 (OCR text attached as a separate file).',
    'Most builders also send a waste management plan and a soil report, so you may',
    'as well include those too.',
    '',
    'Avery',
  ],
);

interface Item {
  clause: string;
  label: string;
  group: string | null;
  description: string | null;
  requirements: string[];
  references: string[];
}
const item = (clause: string, label: string, extra: Partial<Item> = {}): Item => ({
  clause,
  label,
  group: null,
  description: null,
  requirements: [],
  references: [],
  ...extra,
});
const A_REQUIREMENTS = [
  'Show the 900 mm setback to the eastern boundary on sheet A-02.',
  'Add the finished floor level RL 12.450 to the ground floor plan.',
  'Dimension the garage door opening.',
];
const LEVY =
  'Receipt of payment of the levy to the Long Service Corporation (fictional) for the full construction cost.';
const ITEMS: Item[] = [
  item('1', 'Detail and level survey of the site'),
  item('2', 'Section 10.7 planning certificate (2) and (5)'),
  item('3', 'BASIX certificate', {
    requirements: ['BASIX commitments must match the amended architectural plans.'],
  }),
  item('4a', 'Architectural plans', {
    group: 'Design documentation',
    requirements: A_REQUIREMENTS,
  }),
  item('4b', 'Structural engineering plans', { group: 'Design documentation' }),
  item('4c', 'Stormwater drainage plan', {
    group: 'Design documentation',
    requirements: ['Designed to AS/NZS 3500.3:2021', 'Show the on-site detention tank volume'],
    references: ['AS/NZS 3500.3:2021'],
  }),
  item('5', 'Home Building Compensation Fund certificate'),
  item('6', 'Long service levy', { description: LEVY }),
];
const document = (items: Item[]) =>
  ({
    itemCount: items.length,
    clauses: items.map((entry) => entry.clause),
    items: items as unknown as Json,
    notes: ['Assessment will not commence until all items are submitted.'],
  }) as Json;
const figures = (items: Item[]) =>
  keyFigures([
    ['Checklist items', String(items.length)],
    ['Clause order', items.map((entry) => entry.clause).join(', ')],
  ]);
const review = (items: Item[]) =>
  lines(
    '# Checklist transcription - ESC-CDC-2611',
    '',
    'Item 4 is a heading {{cite:checklist|4. Design documentation}}; its lettered children 4a {{cite:checklist|# a. Architectural plans}}, 4b and 4c are separate items.',
    'The list numbered 1 to 3 under 4a {{cite:checklist|1. Show the 900 mm}} restarts at 1 and is 4a requirements, not new items.',
    'The note naming item 3 {{cite:checklist|Item 3 -}} is attached to item 3. The Received cell on item 5 {{cite:checklist|| Received}} is status, not label text.',
    'The header table, the submission instruction and the closing note are not items. The suggested waste plan and soil report in the cover email {{cite:email|waste management plan}} are not on the checklist and are not added.',
    '',
    figures(items),
  );

export const nestedChecklist = (): DocumentCaseSpec => ({
  id: 'compliance/extract-nested-checklist/estuary',
  definitionId: 'D09',
  split: 'held-out',
  role: 'core',
  profile: 'documents',
  title: "Transcribe the certifier's nested document checklist",
  workType: 'extract',
  instruction: `The certifier has sent their document checklist for the Estuary staged build (Lot 7). Transcribe it into tracked items under our checklist policy so the office knows exactly what to supply. Write checklist.json with itemCount, clauses (array in document order), items (each {clause, label, group, description, requirements, references}; requirements are each attached condition as written without its list number or bullet; use null and [] where the certifier wrote nothing) and notes (closing notes that apply to the whole checklist). Write review.md explaining any structure you resolved. ${DOCUMENT_REPORT_RULES} Labels: Checklist items, Clause order (comma-separated).`,
  entities: ['builder', 'project-a', 'certifier-a'],
  scenario:
    'Held-out certifier checklist with lettered children, a restarted numbered requirements list, a trailing item note, a status cell and a cover email inviting extra items.',
  sources: [
    {
      id: 'checklist',
      path: 'documents/certifier-checklist.md',
      mediaType: 'text/markdown',
      content: checklist,
    },
    {
      id: 'email',
      path: 'documents/checklist-cover-email.eml',
      mediaType: 'message/rfc822',
      content: coverEmail,
    },
  ],
  deliverables: [
    {
      path: 'checklist.json',
      mediaType: 'application/json',
      description: 'Transcribed checklist items',
    },
    { path: 'review.md', mediaType: 'text/markdown', description: 'Cited structure review' },
  ],
  criteria: [
    {
      kind: 'fact',
      id: 'C1',
      title: 'Eight items, with no phantom or merged items',
      severity: 'critical',
      category: 'evidence',
      deliverable: 'checklist.json',
      pointer: '/itemCount',
      expected: 8,
      prose: [{ labels: ['checklist items:'], semantics: 'integer' }],
      citations: 'review.md',
      evidence: [
        { source: 'checklist', find: '1. Show the 900 mm', fact: 'Restarted numbering under 4a.' },
        {
          source: 'policy',
          find: 'restarting at',
          fact: 'Nested numbered lists are requirements.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C2',
      title: 'Clause order with lettered children',
      severity: 'critical',
      category: 'evidence',
      deliverable: 'checklist.json',
      pointer: '/clauses',
      expected: ['1', '2', '3', '4a', '4b', '4c', '5', '6'],
      prose: [
        {
          labels: ['clause order:'],
          semantics: 'identifier',
          expected: '1, 2, 3, 4a, 4b, 4c, 5, 6',
        },
      ],
      evidence: [
        { source: 'checklist', find: '4. Design documentation', fact: 'Item 4 is a heading.' },
        {
          source: 'checklist',
          find: '# a. Architectural plans',
          fact: 'Child a is rendered as a heading.',
        },
        { source: 'checklist', find: 'b. Structural', fact: 'Child b is a plain line.' },
      ],
    },
    {
      kind: 'fact',
      id: 'C3',
      title: '4a requirements attached verbatim',
      severity: 'substantive',
      category: 'evidence',
      deliverable: 'checklist.json',
      pointer: '/items/3/requirements',
      expected: A_REQUIREMENTS,
      evidence: [
        {
          source: 'checklist',
          find: 'amended as per following',
          fact: 'Three amendments follow 4a.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C4',
      title: '4c reference copied exactly',
      severity: 'substantive',
      category: 'evidence',
      deliverable: 'checklist.json',
      pointer: '/items/5/references',
      expected: ['AS/NZS 3500.3:2021'],
      evidence: [
        {
          source: 'checklist',
          find: 'Designed to AS/NZS',
          fact: 'Stormwater cites AS/NZS 3500.3:2021.',
        },
      ],
    },
    {
      kind: 'fact',
      id: 'C5',
      title: 'Status cell kept out of the item 5 label',
      severity: 'substantive',
      category: 'evidence',
      deliverable: 'checklist.json',
      pointer: '/items/6/label',
      expected: 'Home Building Compensation Fund certificate',
      evidence: [{ source: 'checklist', find: '| Received', fact: 'Received is a status cell.' }],
    },
    {
      kind: 'fact',
      id: 'C6',
      title: 'Lettered child grouped under its heading',
      severity: 'substantive',
      category: 'evidence',
      deliverable: 'checklist.json',
      pointer: '/items/3/group',
      expected: 'Design documentation',
      evidence: [{ source: 'checklist', find: '4. Design documentation', fact: 'Parent heading.' }],
    },
    {
      kind: 'fact',
      id: 'C7',
      title: 'Levy description copied, not composed',
      severity: 'substantive',
      category: 'evidence',
      deliverable: 'checklist.json',
      pointer: '/items/7/description',
      expected: LEVY,
      evidence: [
        {
          source: 'checklist',
          find: 'Receipt of payment',
          fact: 'Certifier description of item 6.',
        },
      ],
    },
    {
      kind: 'semantic',
      id: 'S1',
      title: 'Trailing note attached to item 3; no invented items',
      severity: 'substantive',
      category: 'evidence',
      deliverables: ['checklist.json', 'review.md'],
      evidence: [
        { source: 'checklist', find: 'Item 3 -', fact: 'Trailing note names item 3.' },
        {
          source: 'email',
          find: 'waste management plan',
          fact: 'Cover email invites extra items.',
        },
      ],
      passIf:
        "Attaches the BASIX note to item 3's requirements and adds no waste management plan, soil report or other item not on the checklist.",
      failIf:
        'Leaves the note detached, attaches it elsewhere, or adds items suggested by the cover email.',
    },
  ],
  allowedOutcomes: [
    { id: 'checklist-transcribed', description: 'Checklist transcribed; nothing supplied or sent' },
  ],
  references: [
    { path: 'lib/agent/checklist-extraction-prompts.ts' },
    { path: 'lib/workflow/compliance-checklist.ts' },
  ],
  controls: [
    {
      id: 'reference',
      kind: 'reference',
      description: 'Eight items with requirements, references and groups attached correctly.',
      failureMode: null,
      files: { 'checklist.json': json(document(ITEMS)), 'review.md': review(ITEMS) },
    },
    (() => {
      const phantom = A_REQUIREMENTS.map((text, index) => item(String(index + 1), text));
      const wrong = [
        ...ITEMS.slice(0, 3),
        { ...ITEMS[3]!, requirements: [] },
        ...phantom,
        ...ITEMS.slice(4),
      ];
      return {
        id: 'phantom-requirements',
        kind: 'negative' as const,
        description: 'Turns the restarted 1-3 amendments under 4a into new checklist items.',
        failureMode: 'invented-value',
        files: { 'checklist.json': json(document(wrong)), 'review.md': review(wrong) },
        expect: { fail: ['C1', 'C2', 'C3', 'C4', 'C5', 'C7'] },
      };
    })(),
    (() => {
      const wrong = [...ITEMS.slice(0, 3), item('4', 'Design documentation'), ...ITEMS.slice(3)];
      return {
        id: 'heading-as-item',
        kind: 'negative' as const,
        description: 'Keeps the Design documentation heading as an item of its own.',
        failureMode: 'invented-value',
        files: { 'checklist.json': json(document(wrong)), 'review.md': review(wrong) },
        expect: { fail: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] },
      };
    })(),
    (() => {
      const wrong = ITEMS.map((entry) =>
        entry.clause === '5'
          ? { ...entry, label: 'Home Building Compensation Fund certificate | Received' }
          : entry,
      );
      return {
        id: 'status-in-label',
        kind: 'negative' as const,
        description: 'Copies the Received status cell into the item 5 label.',
        failureMode: 'wrong-identifier',
        files: { 'checklist.json': json(document(wrong)), 'review.md': review(wrong) },
        expect: { fail: ['C5'] },
      };
    })(),
  ],
});
