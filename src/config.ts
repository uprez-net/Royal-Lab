import { z } from 'zod';
import { ProfileId, Limits } from '#contracts/common';
import { readJson } from '#src/io';

export const DEFAULT_LIMITS = {
  maxTurns: 30,
  maxToolCalls: 60,
  maxInputTokens: 200000,
  maxOutputTokens: 12000,
  maxDurationMs: 300000,
  maxCostUsd: 2,
};
export const ConfigSchema = z.strictObject({
  profile: ProfileId.default('documents'),
  limits: Limits.default(DEFAULT_LIMITS),
  repeats: z.number().int().positive().default(3),
  concurrency: z.number().int().min(1).max(16).default(2),
  runSpendCapUsd: z.number().positive().default(20),
  candidate: z
    .strictObject({
      provider: z.string().min(1),
      model: z.string().min(1),
      parameters: z.record(z.string(), z.json()).default({}),
      apiKey: z.string().optional(),
      apiKeyEnv: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/)
        .optional(),
      pricing: z
        .strictObject({
          version: z.string(),
          asOf: z.iso.datetime({ offset: true }),
          inputUsdPerMillion: z.number().nonnegative(),
          outputUsdPerMillion: z.number().nonnegative(),
          cachedInputUsdPerMillion: z.number().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
  judge: z
    .strictObject({
      provider: z.string().min(1),
      model: z.string().min(1),
      apiKey: z.string().optional(),
    })
    .optional(),
  bridge: z.strictObject({ checkout: z.string(), fixtureDatabaseUrl: z.string() }).optional(),
  binaryParser: z
    .strictObject({
      image: z.string(),
      imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
    })
    .optional(),
});
export type Config = z.infer<typeof ConfigSchema>;
export async function loadConfig(file?: string): Promise<Config> {
  // Deliberately does not read process.env, .env, DATABASE_URL or another checkout.
  return ConfigSchema.parse(file ? await readJson(file) : {});
}
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(?:.*(?:api[_-]?key|secret|password|credential|database[_-]?url|authorization)|(?:access|refresh|bearer|auth)?[_-]?token)$/i.test(
          key,
        )
          ? '[REDACTED]'
          : redact(item),
      ]),
    );
  if (typeof value === 'string')
    return value
      .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1[REDACTED]@')
      .replace(/\b(?:sk|pk)[-_][a-zA-Z0-9_-]{12,}\b/g, '[REDACTED]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  return value;
}
