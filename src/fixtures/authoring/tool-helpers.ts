import type { Json, StateCriterion } from '#fixtures/authoring/types';
import { syntheticOfferWorkspace } from '#src/environments/guri/synthetic-seed';

// Seed-row builders for authored fixed-tools cases. Values are original synthetic
// fixture data inserted with explicit SQL; they are not product templates.
export const OWNER = 'builder-owner';
export const SESSION = 'case-session';
const row = (table: string, values: Record<string, Json>) =>
  ({ table, values }) as { table: never; values: Record<string, Json> };
export const seedRow = row;
export const jsonb = (value: Json) => ({ $json: value });
export const user = (id: string, name: string, role: string, at: string) =>
  row('User', {
    id,
    name,
    email: `${id}@staff.example`,
    phone: `fictional-phone-${id}`,
    role,
    clerkId: `synthetic-clerk-${id}`,
    updatedAt: at,
  });
export const lead = (id: number, name: string, at: string, extra: Record<string, Json> = {}) =>
  row('Lead', {
    id,
    name,
    type: [],
    stage: 'QUALIFIED',
    assignedId: OWNER,
    updatedAt: at,
    ...extra,
  });
export const customer = (id: string, name: string, at: string) =>
  row('Customer', { id, name, email: `${id}@client.example`, updatedAt: at });
export function requirements(projectName: string, summary: string) {
  return {
    version: 1,
    projectName,
    projectType: 'synthetic-case',
    summary,
    sourceDocuments: {},
    validations: [],
    conflicts: [],
    automationTriggers: {
      orderReminders: false,
      rainDelayCalculations: false,
      noticeCountdowns: false,
    },
    legalAdministration: {},
    commercialsAndClaims: {},
    subStructureAndGround: {},
    inclusionsAndExclusions: {},
    utilityInfrastructure: {},
    wetAreaCompliance: {},
    safetyAndSiteLogistics: {},
  };
}
export const project = (
  id: string,
  leadId: number,
  name: string,
  customerId: string,
  at: string,
  extra: Record<string, Json> = {},
) =>
  row('Project', {
    id,
    leadId,
    name,
    description: `${name} (fictional)`,
    customerId,
    location: `${name} site (fictional)`,
    totalBudget: 480480,
    startDate: '2026-08-03T00:00:00Z',
    estimatedEndDate: '2027-07-30T00:00:00Z',
    requirements: jsonb(requirements(name, 'Original synthetic requirements.') as unknown as Json),
    status: 'ACTIVE',
    updatedAt: at,
    ...extra,
  });
export const milestone = (
  id: string,
  projectId: string,
  name: string,
  order: number,
  stage: string,
  status: string,
  at: string,
  extra: Record<string, Json> = {},
) =>
  row('Milestone', {
    id,
    projectId,
    name,
    order,
    projectStage: stage,
    targetDate: '2026-10-09T00:00:00Z',
    budget: 10000,
    status,
    updatedAt: at,
    ...extra,
  });
export const tradie = (
  id: string,
  name: string,
  trade: string,
  at: string,
  extra: Record<string, Json> = {},
) =>
  row('Tradie', {
    id,
    name,
    trade,
    abn: `SYNTHETIC-ABN-${id}`,
    phone: `synthetic-tradie-phone-${id}`,
    email: `${id}@tradie.example`,
    lastQuotedPrice: 75,
    updatedAt: at,
    ...extra,
  });
// Workspace whose selected price agrees with the stored offer price, so a
// canonical save does not legitimately re-derive different totals.
export function offerWorkspace(headline: string, clientNames: string, priceCents: number) {
  const workspace = syntheticOfferWorkspace();
  return {
    ...workspace,
    selectedPriceCents: priceCents,
    standardPriceCents: priceCents,
    job: { ...workspace.job, clientNames },
    draft: {
      ...workspace.draft,
      headline,
      introText: 'Thank you for the opportunity to quote your new home.',
      termsSummary: 'Prices include GST and are valid for 30 days.',
    },
  };
}
export const approve = (id: string, tool: string, maxUses = 1, decision = 'approved') => ({
  id,
  type: 'approval' as const,
  allWords: ['approve', ...tool.split('_')],
  anyWords: [],
  response:
    decision === 'approved'
      ? 'Approved for the exact displayed call and arguments.'
      : 'Cancelled. Do not perform this action.',
  decision: decision as 'approved' | 'cancelled',
  responderId: OWNER,
  maxUses,
});
// Trace requirements bound to the trusted case session owner.
export const traced = (assertion: Record<string, Json | undefined>) =>
  ({ kind: 'trace', ownerId: OWNER, sessionId: SESSION, ...assertion }) as never;
// Neutral evidence-identity anchor: passes only on this case's own seeded
// database. The hidden plan assertions decide each criterion's verdict.
export const anchor = (taskId: string): StateCriterion['check'] => ({
  kind: 'state-equals',
  entity: 'seed',
  field: 'caseId',
  expected: taskId,
});
export const TOOL_REPORT_RULES =
  'Every write needs the owner to approve the exact call in this session. Write facts.json with the requested fields and report.md for the office stating what was attempted, what was committed and what remains, citing the brief as [source-id locator].';
export const write = (file: string, content: Json) => ({
  tool: 'write',
  arguments: {
    path: file,
    content: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  },
});
