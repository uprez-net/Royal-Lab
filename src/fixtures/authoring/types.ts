import type { z } from 'zod';
import type { Criterion } from '#contracts/rubric';
import type { CaseSeed } from '#contracts/authoring';
import type { BridgeControls } from '#contracts/operational';
import type { InteractionScript } from '#src/harness/operator';
import type { VerificationPlan } from '#src/grading/verification';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type TextMediaType =
  'text/markdown' | 'text/plain' | 'text/csv' | 'application/json' | 'message/rfc822';
export interface SourceSpec {
  id: string;
  path: string;
  mediaType: TextMediaType;
  content: string;
}
// Evidence is located by a substring that must occur in exactly one normalized
// unit of the source; the builder records that unit's exact locator.
export interface Ref {
  source: string;
  find: string;
  fact: string;
}
type Severity = 'critical' | 'substantive' | 'diagnostic';
type Category = z.infer<typeof Criterion>['category'];
interface CriterionBase {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  mandatory?: boolean;
  evidence: Ref[];
}
type ProsePlan = Extract<VerificationPlan['assertions'][number], { kind: 'prose' }>;
export interface FactCriterion extends CriterionBase {
  kind: 'fact';
  deliverable: string;
  pointer: string;
  expected: Json;
  prose?: (Omit<ProsePlan, 'kind' | 'criterionId' | 'path' | 'required' | 'expected'> & {
    path?: string;
    expected?: ProsePlan['expected'];
  })[];
  // Every [source locator] citation in the named deliverable must resolve.
  citations?: string;
}
type ToolAssertion = Exclude<
  VerificationPlan['assertions'][number],
  { kind: 'prose' } | { kind: 'citations' }
>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export interface StateCriterion extends CriterionBase {
  kind: 'state';
  check:
    | { kind: 'state-equals'; entity: string; field: string; expected: Json }
    | { kind: 'effect-count'; effect: string; expected: number };
  assertions: DistributiveOmit<ToolAssertion, 'criterionId'>[];
  deliverables?: string[];
}
export interface SemanticCriterion extends CriterionBase {
  kind: 'semantic';
  deliverables: string[];
  passIf: string;
  failIf: string;
}
export type CriterionSpec = FactCriterion | StateCriterion | SemanticCriterion;
export type ControlExpectation = { fail?: string[]; error?: string[]; ungraded?: string[] };
export interface ArtifactControlSpec {
  id: string;
  kind: 'reference' | 'negative';
  description: string;
  failureMode: string | null;
  files: Record<string, string>;
  expect?: ControlExpectation;
}
export interface TrajectoryControlSpec {
  id: string;
  kind: 'reference' | 'negative';
  description: string;
  failureMode: string | null;
  steps: { tool: string; arguments: Json }[][];
  expect?: ControlExpectation;
  expectedStatus?: 'completed' | 'candidate-failure';
}
export interface EnvironmentSpec {
  session?: { sessionId: string; ownerId: string };
  seed: CaseSeed['rows'];
  operator: Omit<InteractionScript, 'schemaVersion' | 'version' | 'review'>;
  bridge?: Partial<Omit<BridgeControls, 'schemaVersion'>>;
  controller?: {
    readFailure?: { tool: string; occurrence: number; kind: 'timeout' | 'specialist-error' };
    acknowledgementLoss?: { tool: string; occurrence: number };
    staleVersion?: {
      injectionId: string;
      projectId: string;
      clock: string;
      patch: { summary: string };
    };
  };
}
interface CaseSpecBase {
  author?: string;
  id: string;
  definitionId: string;
  split: 'development' | 'held-out';
  role: 'core' | 'variant' | 'diagnostic';
  variantOf?: string;
  title: string;
  workType: 'extract' | 'reconcile' | 'analyze' | 'draft' | 'operate' | 'boundary';
  instruction: string;
  entities: string[];
  sources: SourceSpec[];
  deliverables: {
    path: string;
    mediaType: 'application/json' | 'text/markdown';
    description: string;
    required?: boolean;
  }[];
  criteria: CriterionSpec[];
  allowedOutcomes: { id: string; description: string }[];
  operatorBranches?: {
    id: string;
    trigger: 'clarification' | 'approval' | 'stale-version' | 'timeout';
    response: string;
    allowedOutcomeIds: string[];
  }[];
  references: { path: string; use?: 'behavior-reference' | 'methodology-reference' }[];
  scenario: string;
  limits?: Partial<Record<'maxTurns' | 'maxToolCalls', number>>;
}
export interface DocumentCaseSpec extends CaseSpecBase {
  profile: 'documents';
  controls: ArtifactControlSpec[];
}
export interface ToolCaseSpec extends CaseSpecBase {
  profile: 'fixed-tools';
  tools: string[];
  environment: EnvironmentSpec;
  controls: TrajectoryControlSpec[];
}
export type CaseSpec = DocumentCaseSpec | ToolCaseSpec;
