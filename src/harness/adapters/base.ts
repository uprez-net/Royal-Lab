import { z } from 'zod';
import type { LanguageModel } from 'ai';
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
}
export interface AdapterOptions {
  model: string;
  apiKey: string;
  parameters?: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
}
export function validateAdapter(options: AdapterOptions) {
  if (!options.model || !options.apiKey)
    throw new Error('ADAPTER_CONFIG: exact model ID and explicit credential required');
  return ParametersSchema.parse(options.parameters ?? {});
}
