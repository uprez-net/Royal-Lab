import { z } from 'zod';
import { Clock, Hash, Id, MoneyCents, RelativePath, Review, Version } from '#contracts/common';

const Entity = z.strictObject({ id: Id, kind: z.enum(['builder', 'owner', 'lead', 'project', 'offer', 'tradie', 'certifier', 'document', 'invoice']),
  name: z.string().min(1), email: z.email().refine((s) => s.endsWith('.example'), 'Synthetic email must use .example'),
  address: z.string().min(1), references: z.array(Id) });
export const WorldSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'), version: Version, id: Id,
  split: z.enum(['development', 'held-out']), seed: Id,
  scenario: z.string().min(1), clock: Clock,
  jurisdiction: z.literal('AU-NSW'), currency: z.literal('AUD'),
  entities: z.array(Entity).min(1),
  facts: z.strictObject({ directCostCents: MoneyCents, additionsCents: MoneyCents,
    overheadBasisPoints: z.number().int().nonnegative(), feeBasisPoints: z.number().int().nonnegative(),
    gstBasisPoints: z.number().int().nonnegative(), contractCents: MoneyCents,
    spendCents: MoneyCents, remainingCostCents: MoneyCents,
    invoiceCents: MoneyCents, paidCents: MoneyCents }),
  evidence: z.array(z.strictObject({ id: Id, entityId: Id,
    condition: z.enum(['readable', 'partial-scan', 'missing', 'conflicting', 'superseded']),
    revision: z.number().int().positive(), text: z.string() })),
  ambiguity: z.array(z.strictObject({ query: z.string(), entityIds: z.array(Id).min(2) })),
  versionConflicts: z.array(z.strictObject({ entityId: Id, readVersion: z.number().int(), currentVersion: z.number().int() })),
  review: Review,
});
export const FixtureSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'), version: Version, worldId: Id,
  worldPath: RelativePath, worldHash: Hash,
  entityIds: z.array(Id).min(1),
  expectedFacts: z.record(z.string(), z.json()),
});
export type World = z.infer<typeof WorldSchema>;
