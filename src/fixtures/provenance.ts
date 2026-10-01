import { z } from 'zod';
import { Id, RelativePath, Review, Version } from '#contracts/common';

export const ProvenanceSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  version: Version,
  taskId: RelativePath,
  worldId: Id,
  author: z.string().min(1),
  owner: z.string().min(1),
  license: z.literal('LicenseRef-Royal-Lab-Proprietary'),
  synthetic: z.literal(true),
  origin: z.string().min(1),
  sources: z
    .array(
      z.strictObject({
        id: Id,
        url: z.url(),
        revision: z.string().min(1),
        use: z.enum(['behavior-reference', 'methodology-reference', 'original-synthetic']),
        license: z.string().min(1),
        copiedMaterial: z.literal(false),
      }),
    )
    .min(1),
  review: Review,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
