import { z } from 'zod';
const EntityId = z.string().min(1).max(100);
const OfferStatus = z.enum([
  'PENDING',
  'SENT',
  'AGREED',
  'OFFER_SENT',
  'OFFER_SIGNED',
  'OFFER_DECLINED',
  'TENDER_SENT',
  'TENDER_SIGNED',
  'TENDER_DECLINED',
  'CONTRACT_SENT',
  'CONTRACT_SIGNED',
  'CONTRACT_DECLINED',
  'PROJECT',
  'TENDER_DRAFT',
  'CONTRACT_DRAFT',
  'SUPERSEDED',
  'ACCEPTED',
  'REJECTED',
]);
// Deliberately a minimum transport surface. Canonical commands own all domain rules.
// Key length is a refinement, not a key schema: JSON Schema propertyNames is
// stripped by OpenAI-compatible transports, which the loop rightly treats as a
// provider downgrade (tool version 1.1.0; accepted arguments are unchanged).
// Every zod record (including z.json) advertises propertyNames, so the patch is
// an open object whose key and JSON-value rules are enforced as refinements.
const Patch = z
  .object({})
  .catchall(z.unknown())
  .refine(
    (patch) =>
      Object.entries(patch).every(
        ([key, value]) => key.length >= 1 && key.length <= 100 && z.json().safeParse(value).success,
      ),
    'Patch keys must be 1-100 characters with JSON values',
  );
export const GURI_TOOL_SCHEMAS = {
  find_leads: z.strictObject({ query: z.string().min(1).max(100) }),
  search_leads: z.strictObject({ query: z.string().min(1).max(100) }),
  get_lead: z.strictObject({ leadId: z.number().int().positive() }),
  list_lead_tasks: z.strictObject({ leadId: z.number().int().positive() }),
  create_lead_task: z.strictObject({
    leadId: z.number().int().positive(),
    type: z.enum(['CALL', 'EMAIL', 'MEETING', 'WAITING']),
    dueDate: z.iso.date(),
    dueTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
    notes: z.string().max(2000).nullable().default(null),
  }),
  get_offer_details: z.strictObject({ offerId: EntityId }),
  list_offer_revisions: z.strictObject({ leadId: z.number().int().positive() }),
  update_offer_details: z.strictObject({
    offerId: EntityId,
    expectedStateVersion: z.number().int().nonnegative(),
    patch: z.strictObject({
      draft: z.strictObject({
        headline: z.string().max(2000).optional(),
        introText: z.string().max(4000).optional(),
        termsSummary: z.string().max(4000).optional(),
      }),
    }),
  }),
  get_offer_signing_status: z.strictObject({ offerId: EntityId }),
  transition_offer_status: z.strictObject({
    offerId: EntityId,
    toStatus: OfferStatus,
    expectedFromStatus: OfferStatus,
    expectedStateVersion: z.number().int().nonnegative(),
    note: z.string().max(2000).optional(),
  }),
  recall_offer_envelope: z.strictObject({
    offerId: EntityId,
    scope: z.enum(['offer', 'tender', 'contract']),
    toStatus: OfferStatus,
    note: z.string().max(2000).optional(),
  }),
  get_project: z.strictObject({ projectId: EntityId }),
  get_project_requirements: z.strictObject({ projectId: EntityId }),
  update_project_requirements: z.strictObject({
    projectId: EntityId,
    expectedUpdatedAt: z.iso.datetime(),
    patch: Patch,
  }),
  update_milestone: z.strictObject({
    milestoneId: EntityId,
    status: z.enum(['PENDING', 'ACTIVE', 'DONE', 'NOT_REQUIRED']),
    targetDate: z.iso.date().optional(),
    startDate: z.iso.date().optional(),
    actualDate: z.iso.date().optional(),
    spend: z.number().finite().nonnegative().optional(),
  }),
  get_compliance: z.strictObject({ projectId: EntityId }),
  resolve_compliance_document: z.strictObject({
    projectId: EntityId,
    documentId: EntityId,
    decision: z.enum(['approved', 'rejected']),
    rejectionReason: z.string().max(2000).optional(),
  }),
  prepare_compliance_outreach: z.strictObject({
    projectId: EntityId,
    party: z.literal('SURVEYOR'),
  }),
  send_compliance_outreach: z.strictObject({
    projectId: EntityId,
    party: z.literal('SURVEYOR'),
    tradieId: EntityId,
    body: z.string().min(1).max(4000),
    contactEmail: z.email().optional(),
    // Attachments and additional parties remain unsupported in the minimum adapter.
  }),
  get_tradie: z.strictObject({ tradieId: EntityId }),
  list_schedules: z.strictObject({ projectId: EntityId.optional(), tradieId: EntityId.optional() }),
  create_schedule: z.strictObject({
    projectId: EntityId,
    tradieId: EntityId,
    milestoneId: EntityId.optional(),
    scheduledDate: z.iso.date(),
    durationDays: z.number().int().min(1).max(365),
    requiresQuote: z.boolean(),
  }),
  request_price_change: z.strictObject({
    tradieId: EntityId,
    amount: z.number().finite().nonnegative(),
    unit: z.enum(['FIXED', 'HOURLY', 'DAILY']).optional(),
    reason: z.string().min(1).max(2000),
  }),
  list_team: z.strictObject({}),
  update_team_role: z.strictObject({
    userId: EntityId,
    expectedRole: z.enum(['ADMIN', 'SITE_MANAGER', 'CUSTOMER']),
    newRole: z.enum(['ADMIN', 'SITE_MANAGER', 'CUSTOMER']),
  }),
};
export type GuriTool = keyof typeof GURI_TOOL_SCHEMAS;
const VERSIONED: Partial<Record<string, string>> = {
  find_leads: '2.0.0',
  update_project_requirements: '1.1.0',
};
export const GURI_TOOL_VERSIONS = Object.fromEntries(
  Object.keys(GURI_TOOL_SCHEMAS).map((name) => [name, VERSIONED[name] ?? '1.0.0']),
) as Record<GuriTool, string>;
export const GURI_EFFECTS: Record<GuriTool, 'read' | 'mutation'> = {
  find_leads: 'read',
  search_leads: 'read',
  get_lead: 'read',
  list_lead_tasks: 'read',
  create_lead_task: 'mutation',
  get_offer_details: 'read',
  list_offer_revisions: 'read',
  update_offer_details: 'mutation',
  get_offer_signing_status: 'read',
  transition_offer_status: 'mutation',
  recall_offer_envelope: 'mutation',
  get_project: 'read',
  get_project_requirements: 'read',
  update_project_requirements: 'mutation',
  update_milestone: 'mutation',
  get_compliance: 'read',
  resolve_compliance_document: 'mutation',
  prepare_compliance_outreach: 'read',
  send_compliance_outreach: 'mutation',
  get_tradie: 'read',
  list_schedules: 'read',
  create_schedule: 'mutation',
  request_price_change: 'mutation',
  list_team: 'read',
  update_team_role: 'mutation',
};
export function guriTool(name: string): GuriTool {
  if (!Object.hasOwn(GURI_TOOL_SCHEMAS, name))
    throw new Error(
      `GURI_UNSUPPORTED: ${name}; capability not implemented in the minimum canonical bridge`,
    );
  return name as GuriTool;
}
export function parseGuriArguments(name: GuriTool, value: unknown) {
  const seen = new WeakSet<object>();
  const inspect = (item: unknown, depth = 0): void => {
    if (!item || typeof item !== 'object') return;
    if (depth > 64 || seen.has(item)) throw new Error('GURI_JSON_LIMIT');
    seen.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key))
        throw new Error('GURI_UNSAFE_KEY');
      inspect(child, depth + 1);
    }
  };
  // Inspect raw keys before Zod projects the record: dangerous keys must be
  // refused, not accidentally discarded while copying a JSON object.
  inspect(value);
  const parsed = GURI_TOOL_SCHEMAS[name].parse(value);
  const encoded = JSON.stringify(parsed);
  if (encoded.length > 20_000) throw new Error('GURI_ARGUMENT_LIMIT');
  return parsed;
}
