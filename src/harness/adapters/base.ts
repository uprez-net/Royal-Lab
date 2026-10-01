import { z } from 'zod';
import type { LanguageModel } from 'ai';
import { redact } from '#src/config';
export const ParametersSchema = z.strictObject({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  seed: z.number().int().optional(),
  reasoning: z
    .enum(['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    .optional(),
});
export interface CandidateAdapter {
  provider: string;
  modelId: string;
  model: LanguageModel;
  parameters: z.infer<typeof ParametersSchema>;
  transport: 'gateway' | 'direct';
  sdkVersion: string;
  sanitize: (value: unknown) => unknown;
  executionMode: 'paid' | 'offline-control';
}
export interface AdapterOptions {
  model: string;
  apiKey: string;
  parameters?: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
  offlineControl?: boolean;
}
export function validateAdapter(options: AdapterOptions) {
  if (options.offlineControl && !options.fetch) throw new Error('OFFLINE_TRANSPORT_REQUIRED');
  if (!options.model || !options.apiKey)
    throw new Error('ADAPTER_CONFIG: exact model ID and explicit credential required');
  return ParametersSchema.parse(options.parameters ?? {});
}
export function credentialSanitizer(key: string) {
  const sanitize = (value: unknown): unknown => {
    if (typeof value === 'string') return value.replaceAll(key, '[REDACTED]');
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, sanitize(item)]),
      );
    return value;
  };
  return (value: unknown) => sanitize(redact(value));
}
