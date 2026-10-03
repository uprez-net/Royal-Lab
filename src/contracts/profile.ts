import { z } from 'zod';
import { Hash, Limits, ProfileId, Tool, Version } from '#contracts/common';
import { EveDeploymentSchema } from '#contracts/eve';

export const ProfileSchema = z
  .strictObject({
    schemaVersion: z.literal('1.0.0'),
    id: ProfileId,
    version: Version,
    description: z.string().min(1),
    tools: z.array(Tool),
    effectPolicy: z.enum(['none', 'recording-ports', 'staging-cancel-only']),
    candidateNetwork: z.literal(false),
    candidateShell: z.literal(false),
    limits: Limits,
    executionImplemented: z.boolean(),
    guriRevision: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    systemPromptHash: Hash.nullable(),
    parserProfile: z.enum(['normalized-text', 'isolated-binary', 'product-native']),
    // Royal Eve only: the effective deployed agent configuration and the
    // explicitly supported case subset. Optional, so earlier profiles are unchanged.
    deployment: EveDeploymentSchema.optional(),
  })
  .superRefine((profile, ctx) => {
    if (profile.deployment && profile.id !== 'royal-eve')
      ctx.addIssue({ code: 'custom', message: 'Only the royal-eve profile declares a deployment' });
  });
export type Profile = z.infer<typeof ProfileSchema>;
