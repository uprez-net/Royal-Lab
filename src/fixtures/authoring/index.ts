import { jsonText } from '#src/io';
import { SPECIMENS } from '#fixtures/generate';
import { buildCase } from '#fixtures/authoring/build';
import { POLICY_V11 } from '#fixtures/authoring/policy';
import type { CaseSpec } from '#fixtures/authoring/types';
import { adversarialCatalogue } from '#fixtures/authoring/adversarial';
import { graderControlFiles } from '#fixtures/authoring/grader-controls';
import {
  certificateNotPrinted,
  developerVerdictInjected,
  quoteBuildUpInjected,
  titleOwnersUnreadable,
} from '#fixtures/authoring/cases/variants';
import {
  ambiguousBooking,
  cancelledFollowUp,
  forgedApproval,
  outreachOutage,
  unsupportedEmail,
  wrongResponder,
} from '#fixtures/authoring/cases/diagnostics';
import { quoteBuildUp } from '#fixtures/authoring/cases/d01-quote-build-up';
import { revisionPrice } from '#fixtures/authoring/cases/d02-revision-price';
import { paymentSchedule } from '#fixtures/authoring/cases/d03-payment-schedule';
import { inclusionConsistency } from '#fixtures/authoring/cases/d04-inclusion-consistency';
import { contractParticulars } from '#fixtures/authoring/cases/d05-contract-particulars';
import { missingOwnerEvidence } from '#fixtures/authoring/cases/d06-missing-owner-evidence';
import { certificateNumber } from '#fixtures/authoring/cases/d07-certificate-number';
import { stageClaim } from '#fixtures/authoring/cases/d08-stage-claim';
import { nestedChecklist } from '#fixtures/authoring/cases/d09-nested-checklist';
import { certifierDocument } from '#fixtures/authoring/cases/d10-certifier-document';
import { developerVerdict } from '#fixtures/authoring/cases/d11-developer-verdict';
import { titleOwners } from '#fixtures/authoring/cases/d12-title-owners';
import { ambiguousLead, approvedFollowUp } from '#fixtures/authoring/cases/t01-t02-leads';
import {
  completeMilestone,
  currentRevision,
  scheduleConflict,
  unsentApproval,
} from '#fixtures/authoring/cases/t-cedar-operations';
import {
  lastAdmin,
  outreachCancel,
  priceChange,
  recordInjection,
  signingBoundary,
  staleRequirements,
} from '#fixtures/authoring/cases/t-estuary-operations';

// Case specs are functions so authoring modules never evaluate world helpers
// while the generator module graph is still initializing.
export const AUTHORED_CASES: (() => CaseSpec)[] = [
  // #12 quote, contract, insurance and claim documents
  quoteBuildUp,
  revisionPrice,
  paymentSchedule,
  inclusionConsistency,
  contractParticulars,
  missingOwnerEvidence,
  certificateNumber,
  stageClaim,
  // #13 compliance documents
  nestedChecklist,
  certifierDocument,
  developerVerdict,
  titleOwners,
  // #14 lead, offer, project and tradie operations
  ambiguousLead,
  approvedFollowUp,
  currentRevision,
  completeMilestone,
  scheduleConflict,
  signingBoundary,
  staleRequirements,
  priceChange,
  // #13 compliance tool cases
  unsentApproval,
  outreachCancel,
  // #15 admin and injection
  lastAdmin,
  recordInjection,
  // Labelled variants (separate denominators)
  quoteBuildUpInjected,
  certificateNotPrinted,
  developerVerdictInjected,
  titleOwnersUnreadable,
  // #15 safety, boundary, fault and interaction diagnostics
  cancelledFollowUp,
  forgedApproval,
  wrongResponder,
  ambiguousBooking,
  unsupportedEmail,
  outreachOutage,
];

type SuiteProfile = 'documents' | 'fixed-tools';
interface SuiteRow {
  id: string;
  definitionId: string;
  split: 'development' | 'held-out';
  profile: SuiteProfile;
  role: 'core' | 'variant' | 'diagnostic';
}
const SUITES: {
  id: string;
  split: 'development' | 'held-out';
  profile: SuiteProfile;
  roles: SuiteRow['role'][];
  description: string;
}[] = [
  {
    id: 'development',
    split: 'development',
    profile: 'documents',
    roles: ['core'],
    description:
      'Draft development core document cases: one core case per authored definition. Not reviewed, calibrated or execution-ready.',
  },
  {
    id: 'held-out',
    split: 'held-out',
    profile: 'documents',
    roles: ['core'],
    description:
      'Draft held-out core document cases: one core case per authored definition. Never tune prompts or rubrics on these results.',
  },
  {
    id: 'fixed-tools-development',
    split: 'development',
    profile: 'fixed-tools',
    roles: ['core'],
    description:
      'Draft development core fixed-tools cases backed by seeded canonical state. Not reviewed or execution-ready.',
  },
  {
    id: 'fixed-tools-held-out',
    split: 'held-out',
    profile: 'fixed-tools',
    roles: ['core'],
    description:
      'Draft held-out core fixed-tools cases backed by seeded canonical state. Never tune prompts or rubrics on these results.',
  },
  {
    id: 'development-variants',
    split: 'development',
    profile: 'documents',
    roles: ['variant'],
    description:
      'Labelled development document variants and superseded specimens. Separate denominator; never pooled with core results.',
  },
  {
    id: 'held-out-variants',
    split: 'held-out',
    profile: 'documents',
    roles: ['variant'],
    description:
      'Labelled held-out document variants. Separate denominator; never pooled with core results.',
  },
  {
    id: 'safety-diagnostics',
    split: 'development',
    profile: 'fixed-tools',
    roles: ['diagnostic', 'variant'],
    description:
      'Capability-boundary, fault and interaction diagnostics. Reported separately from supported capability success.',
  },
];

export async function authoredFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  files.set('fixtures/policies/nsw-builder-v1.1.md', POLICY_V11);
  files.set('fixtures/adversarial/payloads.json', adversarialCatalogue());
  const rows: SuiteRow[] = [];
  const seen = new Set<string>();
  const specs = AUTHORED_CASES.map((make) => make());
  for (const [relative, content] of graderControlFiles(specs)) files.set(relative, content);
  for (const spec of specs) {
    if (seen.has(spec.id)) throw new Error(`AUTHORING_DUPLICATE_CASE: ${spec.id}`);
    seen.add(spec.id);
    for (const [relative, content] of await buildCase(spec)) files.set(relative, content);
    rows.push({
      id: spec.id,
      definitionId: spec.definitionId,
      split: spec.split,
      profile: spec.profile,
      role: spec.role,
    });
  }
  const cores = new Map<string, string>();
  for (const row of rows.filter((item) => item.role === 'core')) {
    if (cores.has(row.definitionId))
      throw new Error(`AUTHORING_DUPLICATE_CORE: ${row.definitionId}`);
    cores.set(row.definitionId, row.id);
  }
  // Specimens stay in the core denominator only until an authored core case
  // supersedes their definition; they then move to a labelled variant suite.
  for (const specimen of SPECIMENS)
    rows.push({
      id: specimen.id,
      definitionId: specimen.definitionId,
      split: specimen.split,
      profile: 'documents',
      role: cores.has(specimen.definitionId) ? 'variant' : 'core',
    });
  for (const suite of SUITES) {
    const cases = rows
      .filter(
        (row) =>
          row.split === suite.split &&
          suite.roles.includes(row.role) &&
          (suite.id === 'safety-diagnostics'
            ? row.profile === 'fixed-tools' && row.role !== 'core'
            : row.profile === suite.profile &&
              !(row.profile === 'fixed-tools' && row.role !== 'core')),
      )
      .sort((a, b) => a.definitionId.localeCompare(b.definitionId) || a.id.localeCompare(b.id))
      .map((row) => row.id);
    if (cases.length === 0) continue;
    files.set(
      `suites/${suite.id}.json`,
      jsonText({
        schemaVersion: '1.0.0',
        id: suite.id,
        version: '2.0.0',
        split: suite.split,
        profile: suite.profile,
        cases,
        description: suite.description,
      }),
    );
  }
  return files;
}
