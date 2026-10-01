import type { AdapterOptions, CandidateAdapter } from '#src/harness/adapters/base';
import { validateAdapter, credentialSanitizer } from '#src/harness/adapters/base';
export async function gatewayAdapter(options: AdapterOptions): Promise<CandidateAdapter> {
  const parameters = validateAdapter(options);
  const { createGateway } = await import('@ai-sdk/gateway');
  const gateway = createGateway({
    apiKey: options.apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    provider: 'gateway',
    modelId: options.model,
    model: gateway(options.model),
    parameters,
    transport: 'gateway',
    sdkVersion: 'ai-7.0.123/gateway-4.0.101',
    sanitize: credentialSanitizer(options.apiKey),
    executionMode: options.offlineControl ? 'offline-control' : 'paid',
  };
}
