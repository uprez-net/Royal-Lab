import { DEFAULT_LIMITS } from '#src/config';
import { jsonText, sha256 } from '#src/io';
import { readText } from '#src/documents/readers/text';
import { GURI_TOOL_VERSIONS, type GuriTool } from '#src/environments/guri/tools';
import { entityId, GURI_REVISION, makeWorld } from '#fixtures/generate';
import {
  POLICY_V11,
  POLICY_V12,
  POLICY_V12_VERSION,
  POLICY_VERSION,
} from '#fixtures/authoring/policy';
import type { CaseSpec, CriterionSpec, Json, Ref, SourceSpec } from '#fixtures/authoring/types';
import type { VerificationPlan } from '#src/grading/verification';

// Authoring lane for explicitly written draft cases. Output is deterministic and
// frozen by `fixtures generate --check`; nothing here supplies human review.
export const AUTHORED_DRAFT = {
  status: 'draft' as const,
  reviewer: null,
  reviewedAt: null,
  notes:
    'Original synthetic case authored for issues #12-#15. Named NSW residential builder review required before execution.',
};
const policySource = (version: '1.1.0' | '1.2.0'): SourceSpec => ({
  id: 'policy',
  path: 'policies/business.md',
  mediaType: 'text/markdown',
  content: version === POLICY_V12_VERSION ? POLICY_V12 : POLICY_V11,
});
const DOCUMENT_TOOLS = ['list', 'read', 'search', 'write'];

type Units = Map<string, { locator: string; text: string }[]>;
async function normalizedUnits(sources: SourceSpec[]): Promise<Units> {
  const units: Units = new Map();
  for (const source of sources)
    units.set(
      source.id,
      (await readText(new TextEncoder().encode(source.content), source.mediaType)).units,
    );
  return units;
}
export function locate(units: Units, source: string, find: string) {
  const candidates = units.get(source);
  if (!candidates) throw new Error(`AUTHORING_UNKNOWN_SOURCE: ${source}`);
  const matches = candidates.filter((unit) => unit.text.includes(find));
  if (matches.length !== 1)
    throw new Error(
      `AUTHORING_LOCATOR_${matches.length ? 'AMBIGUOUS' : 'MISSING'}: ${source} "${find}" (${matches.length})`,
    );
  return matches[0]!.locator;
}
// Control prose may cite with {{cite:source|unique text}}; it becomes [source locator].
export function resolveCitations(units: Units, text: string) {
  return text.replace(
    /\{\{cite:([a-zA-Z0-9._-]+)\|([^}]+)\}\}/g,
    (_, source: string, find: string) => `[${source} ${locate(units, source, find)}]`,
  );
}
const evidence = (units: Units, refs: Ref[]) =>
  refs.map((ref) => ({
    sourceId: ref.source,
    locator: locate(units, ref.source, ref.find),
    fact: ref.fact,
  }));

function expectedVerdicts(
  criteria: CriterionSpec[],
  expect: { fail?: string[]; error?: string[]; ungraded?: string[] } = {},
) {
  const known = new Set(criteria.map((c) => c.id));
  for (const id of [...(expect.fail ?? []), ...(expect.error ?? []), ...(expect.ungraded ?? [])])
    if (!known.has(id)) throw new Error(`AUTHORING_UNKNOWN_CONTROL_CRITERION: ${id}`);
  return Object.fromEntries(
    criteria.map((criterion) => [
      criterion.id,
      expect.fail?.includes(criterion.id)
        ? 'fail'
        : expect.error?.includes(criterion.id)
          ? 'error'
          : expect.ungraded?.includes(criterion.id) || criterion.kind === 'semantic'
            ? 'ungraded'
            : 'pass',
    ]),
  );
}

export async function buildCase(spec: CaseSpec): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const prefix = `tasks/${spec.id}`;
  const world = makeWorld(spec.split);
  const worldText = jsonText(world);
  const policyVersion = spec.policyVersion ?? POLICY_VERSION;
  const sources = [...spec.sources, policySource(policyVersion)];
  for (const source of spec.sources)
    if (!source.path.startsWith('documents/'))
      throw new Error(`AUTHORING_SOURCE_PATH: ${source.path}`);
  const units = await normalizedUnits(sources);
  const deliverables = spec.deliverables.map((file) => ({
    path: file.path,
    mediaType: file.mediaType,
    description: file.description,
    required: file.required ?? true,
  }));
  const outputs = new Set(deliverables.map((file) => file.path));
  const criteria = spec.criteria.map((criterion) => {
    const base = {
      id: criterion.id,
      title: criterion.title,
      mandatory: criterion.mandatory ?? true,
      severity: criterion.severity,
      category: criterion.category,
      evidence: evidence(units, criterion.evidence),
    };
    if (criterion.kind === 'semantic')
      return {
        ...base,
        deliverables: criterion.deliverables,
        method: 'semantic' as const,
        passIf: criterion.passIf,
        failIf: criterion.failIf,
      };
    if (criterion.kind === 'fact') {
      const scoped = [
        ...new Set([
          criterion.deliverable,
          ...(criterion.prose ?? []).map((p) => p.path ?? 'review.md'),
          ...(criterion.citations ? [criterion.citations] : []),
        ]),
      ];
      return {
        ...base,
        deliverables: scoped,
        method: 'deterministic' as const,
        check: {
          kind: 'json-equals' as const,
          deliverable: criterion.deliverable,
          pointer: criterion.pointer,
          expected: criterion.expected,
        },
      };
    }
    return {
      ...base,
      deliverables: criterion.deliverables ?? [],
      method: 'deterministic' as const,
      check: criterion.check,
    };
  });
  for (const criterion of criteria)
    for (const file of criterion.deliverables)
      if (!outputs.has(file)) throw new Error(`AUTHORING_UNKNOWN_DELIVERABLE: ${file}`);
  const assertions = spec.criteria.flatMap((criterion): VerificationPlan['assertions'] => {
    if (criterion.kind === 'semantic') return [];
    if (criterion.kind === 'state')
      return criterion.assertions.map((assertion) => ({
        ...assertion,
        criterionId: criterion.id,
      }));
    const prose = (criterion.prose ?? []).map((item) => {
      const scalar =
        item.expected !== undefined
          ? item.expected
          : criterion.expected === null || typeof criterion.expected !== 'object'
            ? criterion.expected
            : undefined;
      if (scalar === undefined)
        throw new Error(`AUTHORING_PROSE_EXPECTED: ${criterion.id} needs a scalar prose fact`);
      return {
        kind: 'prose' as const,
        criterionId: criterion.id,
        path: item.path ?? 'review.md',
        labels: item.labels,
        expected: scalar,
        semantics: item.semantics,
        required: true,
      };
    });
    return [
      ...prose,
      ...(criterion.citations
        ? [{ kind: 'citations' as const, criterionId: criterion.id, path: criterion.citations }]
        : []),
    ];
  });
  if (spec.profile === 'documents')
    for (const criterion of spec.criteria)
      if (
        criterion.kind === 'fact' &&
        criterion.severity === 'critical' &&
        !(criterion.prose ?? []).length
      )
        throw new Error(`AUTHORING_CRITICAL_PROSE_MISSING: ${spec.id} ${criterion.id}`);
  const rubric = jsonText({
    schemaVersion: '1.0.0',
    version: '1.0.0',
    taskId: spec.id,
    policyVersion,
    criteria,
  });
  const verification = jsonText({
    schemaVersion: '1.0.0',
    version: '1.0.0',
    taskId: spec.id,
    rubricVersion: '1.0.0',
    review: AUTHORED_DRAFT,
    assertions,
  });
  const fixture = jsonText({
    schemaVersion: '1.0.0',
    version: '1.0.0',
    worldId: world.id,
    worldPath: `fixtures/worlds/${world.id}.json`,
    worldHash: sha256(worldText),
    entityIds: spec.entities.map((label) => entityId(world.seed, label)),
    expectedFacts: Object.fromEntries(
      spec.criteria
        .filter((c) => c.kind === 'fact')
        .map((c) => [`${c.deliverable}#${c.pointer}`, c.expected as Json]),
    ),
  });
  const controlEntries = [];
  for (const control of spec.controls) {
    const expected = expectedVerdicts(spec.criteria, control.expect);
    if ('files' in control) {
      const controlOutputs = [];
      for (const [file, raw] of Object.entries(control.files)) {
        if (!outputs.has(file)) throw new Error(`AUTHORING_CONTROL_OUTPUT: ${control.id} ${file}`);
        const content = resolveCitations(units, raw);
        files.set(`${prefix}/grading/controls/${control.id}/${file}`, content);
        controlOutputs.push({ path: file, sha256: sha256(content) });
      }
      controlEntries.push({
        id: control.id,
        kind: control.kind,
        description: control.description,
        failureMode: control.failureMode,
        expected,
        mode: 'artifacts' as const,
        outputs: controlOutputs,
      });
    } else
      controlEntries.push({
        id: control.id,
        kind: control.kind,
        description: control.description,
        failureMode: control.failureMode,
        expected,
        mode: 'trajectory' as const,
        steps: control.steps.map((turn) =>
          turn.map((call) =>
            call.tool === 'write' &&
            call.arguments !== null &&
            typeof call.arguments === 'object' &&
            !Array.isArray(call.arguments) &&
            typeof call.arguments.content === 'string'
              ? {
                  ...call,
                  arguments: {
                    ...call.arguments,
                    content: resolveCitations(units, call.arguments.content),
                  },
                }
              : call,
          ),
        ),
        expectedStatus: control.expectedStatus ?? ('completed' as const),
      });
  }
  const controls = jsonText({
    schemaVersion: '1.0.0',
    version: '1.0.0',
    taskId: spec.id,
    rubricVersion: '1.0.0',
    review: AUTHORED_DRAFT,
    provenance:
      'Original synthetic reference and consequential negative outputs authored to validate graders; not model outputs or reviewed gold labels.',
    controls: controlEntries,
  });
  const environment =
    spec.profile === 'fixed-tools'
      ? jsonText({
          schemaVersion: '1.0.0',
          // 1.1.0 read faults; 1.2.0 offer stale-version injection. Earlier
          // environments keep their versions and bytes.
          version:
            spec.environment.controller?.staleVersion &&
            'offerId' in spec.environment.controller.staleVersion
              ? '1.2.0'
              : spec.environment.controller?.readFailure
                ? '1.1.0'
                : '1.0.0',
          taskId: spec.id,
          review: AUTHORED_DRAFT,
          session: spec.environment.session ?? {
            sessionId: 'case-session',
            ownerId: 'builder-owner',
          },
          seed: { schemaVersion: '1.0.0', rows: spec.environment.seed },
          operator: {
            schemaVersion: '1.0.0',
            version: '1.0.0',
            review: AUTHORED_DRAFT,
            ...spec.environment.operator,
          },
          bridge: {
            schemaVersion: '1.0.0',
            mode: 'benchmark',
            ports: { schemaVersion: '1.0.0', email: 'unavailable', envelope: 'unavailable' },
            timeoutMs: 20_000,
            ...spec.environment.bridge,
          },
          controller: spec.environment.controller ?? {},
        })
      : null;
  const provenance = jsonText({
    schemaVersion: '1.0.0',
    version: '1.0.0',
    taskId: spec.id,
    worldId: world.id,
    author: spec.author ?? 'Royal-Lab case authoring (Claude Code draft for issues #12-#15)',
    owner: 'uprez-net/Royal-Lab',
    license: 'LicenseRef-Royal-Lab-Proprietary',
    synthetic: true,
    origin: `Original fictional case material. ${spec.scenario} No client templates, records, transcripts or quote data copied.`,
    sources: [
      ...spec.references.map((reference, index) => ({
        id: `domain-reference-${index + 1}`,
        url: `https://github.com/uprez-net/Royal-Construction/blob/${GURI_REVISION}/${reference.path}`,
        revision: GURI_REVISION,
        use: reference.use ?? 'behavior-reference',
        license: 'Private product reference; no redistribution',
        copiedMaterial: false,
      })),
      {
        id: 'policy-decision',
        url: 'https://github.com/uprez-net/Royal-Lab/issues/1',
        revision: 'scope-decision-2026-10-01',
        use: 'original-synthetic',
        license: 'LicenseRef-Royal-Lab-Proprietary',
        copiedMaterial: false,
      },
    ],
    review: AUTHORED_DRAFT,
  });
  for (const source of sources) files.set(`${prefix}/${source.path}`, source.content);
  files.set(`${prefix}/grading/fixture.json`, fixture);
  files.set(`${prefix}/grading/rubric.json`, rubric);
  files.set(`${prefix}/grading/verification.json`, verification);
  files.set(`${prefix}/grading/controls.json`, controls);
  if (environment) files.set(`${prefix}/grading/environment.json`, environment);
  files.set(`${prefix}/provenance.json`, provenance);
  const tools = spec.profile === 'fixed-tools' ? spec.tools : DOCUMENT_TOOLS;
  const limits = { ...DEFAULT_LIMITS, ...spec.limits };
  files.set(
    `${prefix}/task.json`,
    jsonText({
      schemaVersion: '1.2.0',
      role: spec.role,
      variantOf: spec.variantOf ?? null,
      version: '1.0.0',
      scenarioVersion: '1.0.0',
      id: spec.id,
      definitionId: spec.definitionId,
      title: spec.title,
      family: spec.id.split('/')[0],
      workType: spec.workType,
      instruction: spec.instruction,
      profiles: [spec.profile],
      worldId: world.id,
      clock: world.clock,
      jurisdiction: 'AU-NSW',
      currency: 'AUD',
      inputs: sources.map((source) => ({
        id: source.id,
        path: source.path,
        sha256: sha256(source.content),
        kind: source.id === 'policy' ? 'policy' : 'document',
        mediaType: source.mediaType,
      })),
      tools: tools.map((name) => ({
        name,
        version: GURI_TOOL_VERSIONS[name as GuriTool] ?? '1.0.0',
      })),
      deliverables,
      fixturePath: 'grading/fixture.json',
      fixtureHash: sha256(fixture),
      rubricPath: 'grading/rubric.json',
      rubricHash: sha256(rubric),
      provenancePath: 'provenance.json',
      provenanceHash: sha256(provenance),
      verificationPath: 'grading/verification.json',
      verificationHash: sha256(verification),
      controlsPath: 'grading/controls.json',
      controlsHash: sha256(controls),
      ...(environment
        ? { environmentPath: 'grading/environment.json', environmentHash: sha256(environment) }
        : {}),
      operatorBranches: spec.operatorBranches ?? [],
      allowedOutcomes: spec.allowedOutcomes,
      limits,
    }),
  );
  return files;
}
