import type { AdapterOptions, CandidateAdapter } from '#src/harness/adapters/base';
import { validateAdapter } from '#src/harness/adapters/base';
export async function directAdapter(options: AdapterOptions): Promise<CandidateAdapter> {
  const parameters = validateAdapter(options);
  const { createOpenAI } = await import('@ai-sdk/openai');
  const provider = createOpenAI({
    apiKey: options.apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    provider: 'openai',
    modelId: options.model,
    model: provider.chat(options.model),
    parameters,
    transport: 'direct',
    sdkVersion: 'ai-7.0.123/openai-4.0.82',
  };
}
