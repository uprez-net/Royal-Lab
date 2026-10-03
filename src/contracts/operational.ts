import { z } from 'zod';
import { Id, Hash } from '#contracts/common';

// Trusted controller configuration; never part of a candidate tool's arguments.
export const RecordingPortPolicySchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  email: z.enum(['unavailable', 'record-success', 'record-failure']).default('unavailable'),
  envelope: z.enum(['unavailable', 'record-success', 'record-failure']).default('unavailable'),
});
export type RecordingPortPolicy = z.infer<typeof RecordingPortPolicySchema>;
// 1.0.0: concurrent project requirements edit (unchanged).
export const ProjectStaleVersionControlSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  injectionId: Id,
  projectId: z.string().min(1).max(100),
  afterReadCallId: Id,
  beforeWriteCallId: Id,
  clock: z.iso.datetime(),
  patch: z.strictObject({ summary: z.string().min(1).max(2000) }),
});
// 1.1.0: concurrent edit of the current editable offer revision through the
// canonical versioned workspace save, between the candidate's read and write.
export const OfferStaleVersionControlSchema = z.strictObject({
  schemaVersion: z.literal('1.1.0'),
  target: z.literal('offer-details'),
  injectionId: Id,
  offerId: z.string().min(1).max(100),
  afterReadCallId: Id,
  beforeWriteCallId: Id,
  clock: z.iso.datetime(),
  patch: z.strictObject({
    draft: z
      .strictObject({
        headline: z.string().max(2000).optional(),
        introText: z.string().max(4000).optional(),
        termsSummary: z.string().max(4000).optional(),
      })
      .refine((draft) => Object.keys(draft).length > 0, 'An offer injection must change a field'),
  }),
});
export const StaleVersionControlSchema = z.union([
  ProjectStaleVersionControlSchema,
  OfferStaleVersionControlSchema,
]);
export type StaleVersionControl = z.infer<typeof StaleVersionControlSchema>;
export const BridgeControlsSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  mode: z.enum(['benchmark', 'offline-control']).default('benchmark'),
  ports: RecordingPortPolicySchema.default({
    schemaVersion: '1.0.0',
    email: 'unavailable',
    envelope: 'unavailable',
  }),
  staleVersion: StaleVersionControlSchema.optional(),
  fault: z
    .strictObject({
      tool: z.string().min(1).max(100),
      point: z.enum(['before-dispatch', 'after-write']),
      mode: z.enum(['error', 'timeout']),
    })
    .optional(),
  timeoutMs: z.number().int().min(50).max(20_000).default(20_000),
});
export type BridgeControls = z.infer<typeof BridgeControlsSchema>;

const JsonRows = z.array(z.record(z.string(), z.json()));
export const RecordingPortReceiptSchema = z.strictObject({
  key: z.string(),
  operationKey: z.string(),
  kind: z.enum(['email', 'envelope-void', 'envelope-status', 'identity-role', 'xero-claim']),
  payloadHash: Hash,
  status: z.enum(['succeeded', 'failed', 'unavailable']),
  simulation: z.literal(true),
});
const InjectionRecord = z.strictObject({
  key: z.string(),
  binding: Hash,
  kind: z.literal('controller-stale-version'),
  before: z.json(),
  after: z.json(),
});
export const CanonicalSnapshotSchema = z.strictObject({
  schemaVersion: z.literal('2.0.0'),
  source: z.literal('independent-postgresql-connection'),
  database: z.string().regex(/^royal_lab_run_[a-f0-9]{32}$/),
  leads: JsonRows,
  tasks: JsonRows,
  history: JsonRows,
  operations: JsonRows,
  offers: JsonRows,
  offerEvents: JsonRows,
  envelopes: JsonRows,
  projects: JsonRows,
  milestones: JsonRows,
  activityLogs: JsonRows,
  engagements: JsonRows,
  complianceDocuments: JsonRows,
  outreaches: JsonRows,
  schedules: JsonRows,
  tradies: JsonRows,
  approvals: JsonRows,
  outbox: JsonRows,
  invoices: JsonRows,
  users: JsonRows,
  portEffects: z.array(RecordingPortReceiptSchema),
  controlInjections: z.array(InjectionRecord),
  seed: JsonRows,
});
export const CanonicalStateEvidenceSchema = z.strictObject({
  schemaVersion: z.literal('2.0.0'),
  source: z.literal('independent-postgresql-connection'),
  before: CanonicalSnapshotSchema,
  after: CanonicalSnapshotSchema,
});
export const FixtureInitializationSchema = z.strictObject({
  schemaVersion: z.literal('2.0.0'),
  database: z.string(),
  snapshotHash: Hash,
  snapshot: CanonicalSnapshotSchema,
});
