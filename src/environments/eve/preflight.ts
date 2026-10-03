import { ProfileSchema, type Profile } from '#contracts/profile';
import { EveDeploymentSchema, type EveDeployment } from '#contracts/eve';
import { validateTarget } from '#src/harness/adapters/royal-eve';

// Offline Royal Eve preflight. It runs before any bootstrap request and blocks
// on anything that could reach production, the wrong database or an unpinned
// deployment. Live target facts (preview, database label, fixture version,
// flags, info version) are re-checked by the client bootstrap.
export interface EveRunConfig {
  target: string;
  stagingHost: string | null;
  secretEnv: string;
  cases: string[];
  // Present only so a misconfiguration is caught: the evaluator must not hold these.
  [key: string]: unknown;
}
export interface EvePreflight {
  valid: boolean;
  errors: string[];
  selected: { caseId: string; status: 'ready' | 'excluded'; reason: string | null }[];
  deployment: EveDeployment | null;
}
const FORBIDDEN_KEYS = /database|clerk|bearer|authToken|DATABASE_URL|EVE_EVAL_AUTH_TOKEN/i;

export function evePreflight(
  profileInput: unknown,
  config: EveRunConfig,
  environment: Record<string, string | undefined>,
): EvePreflight {
  const errors: string[] = [];
  let profile: Profile;
  try {
    profile = ProfileSchema.parse(profileInput);
  } catch (error) {
    return {
      valid: false,
      errors: [`Profile invalid: ${String(error)}`],
      selected: [],
      deployment: null,
    };
  }
  if (profile.id !== 'royal-eve') errors.push('Profile is not royal-eve');
  if (profile.effectPolicy !== 'staging-cancel-only')
    errors.push('Royal Eve must be staging-cancel-only');
  const parsed = EveDeploymentSchema.safeParse(profile.deployment);
  if (!parsed.success) {
    errors.push(`Deployment pins invalid: ${parsed.error.message}`);
    return { valid: false, errors, selected: [], deployment: null };
  }
  const deployment = parsed.data;
  try {
    validateTarget(config.target, config.stagingHost);
  } catch (error) {
    errors.push(String(error instanceof Error ? error.message : error));
  }
  if (/(^|\.)prod|production/i.test(config.target)) errors.push('Target looks like production');
  // Pins that must be filled privately before a live run.
  if (!deployment.agentCommit) errors.push('Deployed agent commit is not pinned');
  if (!deployment.deploymentHost) errors.push('Deployment host is not pinned');
  if (!deployment.promptsHash) errors.push('Agent prompts hash is not pinned');
  if (!deployment.toolCatalogueHash) errors.push('Tool catalogue hash is not pinned');
  if (!/^[A-Z][A-Z0-9_]*$/.test(config.secretEnv))
    errors.push('Bootstrap secret variable name invalid');
  else if (!environment[config.secretEnv])
    errors.push(`Bootstrap secret ${config.secretEnv} is not set`);
  // The evaluator holds no database or Clerk secret and no direct bearer override.
  for (const key of Object.keys(config))
    if (FORBIDDEN_KEYS.test(key)) errors.push(`Evaluator config must not hold ${key}`);
  for (const key of ['EVE_EVAL_AUTH_TOKEN', 'EVE_EVAL_FIXTURE_DATABASE_URL', 'CLERK_SECRET_KEY'])
    if (environment[key]) errors.push(`Evaluator environment must not hold ${key}`);
  if (!profile.executionImplemented)
    errors.push('Royal Eve execution is not enabled in the profile');
  const selected = config.cases.map((caseId) => {
    const supported = deployment.supportedCases.find((item) => item.id === caseId);
    if (!supported)
      return {
        caseId,
        status: 'excluded' as const,
        reason: 'Not in the Royal Eve supported subset; listed profile exclusions apply',
      };
    if (!environment[supported.fixtureLabelEnv])
      return {
        caseId,
        status: 'excluded' as const,
        reason: `Fixture label ${supported.fixtureLabelEnv} is unset`,
      };
    return { caseId, status: 'ready' as const, reason: null };
  });
  if (!selected.some((item) => item.status === 'ready')) errors.push('No supported case is ready');
  return { valid: errors.length === 0, errors, selected, deployment };
}
