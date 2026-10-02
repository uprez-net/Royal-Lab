import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ProfileSchema, type Profile } from '#contracts/profile';
import { RubricSchema, type Rubric } from '#contracts/rubric';
import { SuiteSchema, type Suite, type Task } from '#contracts/task';
import { ProvenanceSchema, type Provenance } from '#fixtures/provenance';
import { FixtureSchema, WorldSchema } from '#fixtures/world';
import { lintWorld } from '#fixtures/lint';
import { readJson, readScoped, securePath, sha256, walk } from '#src/io';
import { discover } from '#tasks/discover';
import { VerificationPlanSchema, type VerificationPlan } from '#src/grading/verification';
import {
  CaseControlsSchema,
  CaseEnvironmentSchema,
  type CaseControls,
  type CaseEnvironment,
} from '#contracts/authoring';
import { readText } from '#src/documents/readers/text';

export function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}
export interface ValidatedTask {
  task: Task;
  rubric: Rubric;
  provenance: Provenance;
  directory: string;
  verification: VerificationPlan | null;
  controls: CaseControls | null;
  environment: CaseEnvironment | null;
}
const TEXT_MEDIA = [
  'text/markdown',
  'text/plain',
  'application/json',
  'text/csv',
  'message/rfc822',
];
async function validateAuthored(directory: string, task: Task, rubric: Rubric) {
  if (task.schemaVersion !== '1.2.0') return { controls: null, environment: null };
  const hidden = async (file: string, hash: string) => {
    if (!file.startsWith('grading/')) throw new Error(`Authored material must be hidden: ${file}`);
    const bytes = await readScoped(directory, file);
    if (sha256(bytes) !== hash) throw new Error(`Hidden file hash mismatch: ${file}`);
    return JSON.parse(bytes.toString('utf8')) as unknown;
  };
  const controls = CaseControlsSchema.parse(await hidden(task.controlsPath!, task.controlsHash!));
  if (controls.taskId !== task.id || controls.rubricVersion !== rubric.version)
    throw new Error('Controls task/rubric identity mismatch');
  const criterionIds = rubric.criteria.map((criterion) => criterion.id).sort();
  for (const control of controls.controls) {
    if (JSON.stringify(Object.keys(control.expected).sort()) !== JSON.stringify(criterionIds))
      throw new Error(`Control ${control.id} must state an expectation for every criterion`);
    for (const [id, verdict] of Object.entries(control.expected)) {
      const criterion = rubric.criteria.find((item) => item.id === id)!;
      if (control.kind === 'negative' && verdict === 'fail' && !criterion.mandatory)
        throw new Error(`Control ${control.id} relies on an optional criterion`);
    }
    if (control.mode === 'artifacts') {
      if (!task.profiles.includes('documents'))
        throw new Error('Artifact controls are for document cases');
      for (const output of control.outputs) {
        if (!task.deliverables.some((file) => file.path === output.path))
          throw new Error(`Control ${control.id} writes an undeclared deliverable`);
        const file = `grading/controls/${control.id}/${output.path}`;
        if (sha256(await readScoped(directory, file)) !== output.sha256)
          throw new Error(`Control output hash mismatch: ${file}`);
      }
    } else if (!task.profiles.includes('fixed-tools'))
      throw new Error('Trajectory controls are for fixed-tools cases');
    else if (control.kind === 'reference')
      // Negative controls may deliberately call undeclared tools.
      for (const turn of control.steps)
        for (const call of turn)
          if (!task.tools.some((tool) => tool.name === call.tool))
            throw new Error(`Control ${control.id} calls undeclared tool ${call.tool}`);
  }
  const environment = task.environmentPath
    ? CaseEnvironmentSchema.parse(await hidden(task.environmentPath, task.environmentHash!))
    : null;
  if (environment && environment.taskId !== task.id)
    throw new Error('Environment task identity mismatch');
  if (environment && environment.bridge.mode !== 'benchmark')
    throw new Error('Authored environments use benchmark-mode recording ports');
  // Every criterion locator must name exactly one normalized unit; reviewers and
  // judges must never receive whole-document or fuzzy evidence.
  const units = new Map<string, string[]>();
  for (const input of task.inputs) {
    if (!TEXT_MEDIA.includes(input.mediaType))
      throw new Error(`Authored evidence must be text-normalized: ${input.path}`);
    const parsed = await readText(await readScoped(directory, input.path), input.mediaType);
    units.set(
      input.id,
      parsed.units.map((unit) => unit.locator),
    );
  }
  for (const criterion of rubric.criteria)
    for (const evidence of criterion.evidence)
      if ((units.get(evidence.sourceId) ?? []).filter((l) => l === evidence.locator).length !== 1)
        throw new Error(
          `Unresolved evidence locator: ${criterion.id} ${evidence.sourceId} ${evidence.locator}`,
        );
  return { controls, environment };
}
export async function validateTask(root: string, task: Task): Promise<ValidatedTask> {
  const directory = await securePath(root, `tasks/${task.id}`);
  unique(
    task.inputs.map((x) => x.id),
    'input IDs',
  );
  unique(
    task.inputs.map((x) => x.path),
    'input paths',
  );
  unique(
    task.deliverables.map((x) => x.path),
    'deliverables',
  );
  unique(task.profiles, 'profiles');
  unique(
    task.tools.map((x) => x.name),
    'tools',
  );
  unique(
    task.allowedOutcomes.map((x) => x.id),
    'outcomes',
  );
  unique(
    task.operatorBranches.map((x) => x.id),
    'operator branches',
  );
  const outcomes = new Set(task.allowedOutcomes.map((x) => x.id));
  for (const branch of task.operatorBranches) {
    for (const id of branch.allowedOutcomeIds)
      if (!outcomes.has(id)) throw new Error(`Unknown branch outcome: ${id}`);
  }
  for (const input of task.inputs) {
    const prefix = input.kind === 'policy' ? 'policies/' : 'documents/';
    if (!input.path.startsWith(prefix))
      throw new Error(`Visible input outside ${prefix}: ${input.path}`);
    if (
      input.path.split('/').some((p) => /^(grading|expected|credentials|results|\.env)$/i.test(p))
    ) {
      throw new Error(`Hidden material in visible input: ${input.path}`);
    }
    if (sha256(await readScoped(directory, input.path)) !== input.sha256)
      throw new Error(`Input hash mismatch: ${input.path}`);
  }
  if (!task.inputs.some((x) => x.kind === 'policy'))
    throw new Error('Missing candidate-visible policy');
  if (!task.rubricPath.startsWith('grading/') || !task.fixturePath.startsWith('grading/'))
    throw new Error('Rubric and fixture must live in grading/');
  for (const [file, hash] of [
    [task.fixturePath, task.fixtureHash],
    [task.rubricPath, task.rubricHash],
    [task.provenancePath, task.provenanceHash],
  ]) {
    if (sha256(await readScoped(directory, file!)) !== hash)
      throw new Error(`Hidden file hash mismatch: ${file}`);
  }
  const rubric = RubricSchema.parse(
    JSON.parse((await readScoped(directory, task.rubricPath)).toString('utf8')),
  );
  const provenance = ProvenanceSchema.parse(
    JSON.parse((await readScoped(directory, task.provenancePath)).toString('utf8')),
  );
  let verification: VerificationPlan | null = null;
  if (task.verificationPath && task.verificationHash) {
    if (!task.verificationPath.startsWith('grading/'))
      throw new Error('Verifier must be hidden in grading/');
    const bytes = await readScoped(directory, task.verificationPath);
    if (sha256(bytes) !== task.verificationHash) throw new Error('Hidden verifier hash mismatch');
    verification = VerificationPlanSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (verification.taskId !== task.id || verification.rubricVersion !== rubric.version)
      throw new Error('Verifier task/rubric identity mismatch');
    for (const assertion of verification.assertions) {
      if (!rubric.criteria.some((criterion) => criterion.id === assertion.criterionId))
        throw new Error('Unknown verifier criterion');
      if ('path' in assertion && !task.deliverables.some((file) => file.path === assertion.path))
        throw new Error('Unknown verifier deliverable');
    }
    if (task.profiles.includes('documents'))
      for (const criterion of rubric.criteria.filter(
        (item) => item.method === 'deterministic' && item.severity === 'critical',
      ))
        if (
          !verification.assertions.some(
            (assertion) =>
              assertion.criterionId === criterion.id &&
              assertion.kind === 'prose' &&
              assertion.required,
          )
        )
          throw new Error('Critical fact requires an explicit prose verifier');
  }
  const fixture = FixtureSchema.parse(
    JSON.parse((await readScoped(directory, task.fixturePath)).toString('utf8')),
  );
  if (rubric.taskId !== task.id || provenance.taskId !== task.id)
    throw new Error('Cross-file task identity mismatch');
  if (provenance.worldId !== task.worldId || fixture.worldId !== task.worldId)
    throw new Error('Cross-file world identity mismatch');
  const worldBytes = await readScoped(root, fixture.worldPath);
  if (sha256(worldBytes) !== fixture.worldHash) throw new Error('World hash mismatch');
  const world = WorldSchema.parse(JSON.parse(worldBytes.toString('utf8')));
  const worldFindings = lintWorld(world);
  if (worldFindings.length > 0) throw new Error(`Inconsistent world: ${worldFindings.join(', ')}`);
  if (world.id !== task.worldId || JSON.stringify(world.clock) !== JSON.stringify(task.clock))
    throw new Error('World identity/clock mismatch');
  if (fixture.entityIds.some((id) => !world.entities.some((e) => e.id === id)))
    throw new Error('Fixture references unknown entity');
  unique(
    rubric.criteria.map((x) => x.id),
    'criterion IDs',
  );
  unique(
    provenance.sources.map((x) => x.id),
    'provenance source IDs',
  );
  const sourceIds = new Set(task.inputs.map((x) => x.id));
  const outputs = new Set(task.deliverables.map((x) => x.path));
  for (const criterion of rubric.criteria) {
    if (task.profiles.includes('documents') && criterion.deliverables.length === 0)
      throw new Error('Document criterion requires a deliverable');
    for (const file of criterion.deliverables)
      if (!outputs.has(file)) throw new Error(`Unknown criterion deliverable: ${file}`);
    for (const evidence of criterion.evidence)
      if (!sourceIds.has(evidence.sourceId))
        throw new Error(`Unknown evidence source: ${evidence.sourceId}`);
    if (criterion.method === 'deterministic') {
      if (
        criterion.check.kind === 'json-equals' &&
        !criterion.deliverables.includes(criterion.check.deliverable)
      )
        throw new Error('Check deliverable is not scoped to criterion');
      if (task.profiles.includes('documents') && criterion.check.kind !== 'json-equals')
        throw new Error('Document task requires artifact checks, not database/effect checks');
    }
  }
  const { controls, environment } = await validateAuthored(directory, task, rubric);
  return { task, rubric, provenance, directory, verification, controls, environment };
}
export interface Selection {
  taskId: string;
  status: 'ready' | 'excluded' | 'invalid';
  reason: string | null;
}
export interface Preflight {
  valid: boolean;
  suite: Suite;
  profile: Profile;
  cases: Selection[];
  errors: string[];
}
export async function preflight(
  root: string,
  suiteFile: string,
  forRun = false,
): Promise<Preflight> {
  const suite = SuiteSchema.parse(await readJson(await securePath(root, suiteFile)));
  const profile = ProfileSchema.parse(
    await readJson(await securePath(root, `profiles/${suite.profile}.json`)),
  );
  unique(suite.cases, 'selected case IDs');
  const discovered = await discover(root);
  const cases: Selection[] = [];
  const errors: string[] = [];
  for (const id of suite.cases) {
    const selected = discovered.find((entry) => entry.task.id === id);
    if (!selected) {
      cases.push({ taskId: id, status: 'invalid', reason: 'Selected task is missing' });
      continue;
    }
    if (!selected.task.profiles.includes(suite.profile)) {
      cases.push({
        taskId: id,
        status: 'excluded',
        reason: `Unsupported profile ${suite.profile}`,
      });
      continue;
    }
    try {
      const validated = await validateTask(root, selected.task);
      const fixture = FixtureSchema.parse(
        await readJson(path.join(validated.directory, selected.task.fixturePath)),
      );
      const world = WorldSchema.parse(await readJson(await securePath(root, fixture.worldPath)));
      if (world.split !== suite.split) throw new Error('Case world belongs to a different split');
      for (const tool of selected.task.tools) {
        if (!profile.tools.some((t) => t.name === tool.name && t.version === tool.version))
          throw new Error(`Unsupported tool/version: ${tool.name}@${tool.version}`);
      }
      if (
        forRun &&
        (validated.provenance.review.status !== 'approved' || world.review.status !== 'approved')
      )
        throw new Error('Human review is pending');
      if (
        forRun &&
        (suite.profile === 'documents' || selected.task.schemaVersion === '1.2.0') &&
        validated.verification?.review.status !== 'approved'
      )
        throw new Error('Human verifier review is pending');
      if (forRun && validated.controls && validated.controls.review.status !== 'approved')
        throw new Error('Human control review is pending');
      if (
        forRun &&
        validated.environment &&
        (validated.environment.review.status !== 'approved' ||
          validated.environment.operator.review.status !== 'approved')
      )
        throw new Error('Human environment/operator review is pending');
      if (forRun && !profile.executionImplemented)
        throw new Error('Profile execution is not implemented (later issues)');
      cases.push({ taskId: id, status: 'ready', reason: null });
    } catch (error) {
      cases.push({ taskId: id, status: 'invalid', reason: String(error) });
    }
  }
  // Whole-world isolation across every suite, including unselected cases.
  const suites = await Promise.all(
    (await walk(path.join(root, 'suites')))
      .filter((file) => file.endsWith('.json'))
      .map(async (file) =>
        SuiteSchema.parse(await readJson(await securePath(root, `suites/${file}`))),
      ),
  );
  const worlds = (split: Suite['split']) =>
    new Set(
      suites
        .filter((item) => item.split === split)
        .flatMap((item) => item.cases)
        .map((id) => discovered.find((x) => x.task.id === id)?.task.worldId)
        .filter(Boolean),
    );
  const devWorlds = worlds('development');
  if ([...worlds('held-out')].some((id) => devWorlds.has(id)))
    errors.push('Development/held-out world leakage');
  // A core denominator holds one authored core case per definition and no variants.
  const core =
    suite.id === 'development' || suite.id === 'held-out' || suite.id.startsWith('fixed-tools-');
  const definitions = new Set<string>();
  for (const id of suite.cases) {
    const task = discovered.find((x) => x.task.id === id)?.task;
    if (!task) continue;
    if (core && task.role && task.role !== 'core')
      errors.push(`Non-core case in core suite: ${id}`);
    if (!core && task.role === 'core') errors.push(`Core case outside a core suite: ${id}`);
    if (core) {
      if (definitions.has(task.definitionId))
        errors.push(`Duplicate core definition: ${task.definitionId}`);
      definitions.add(task.definitionId);
    }
  }
  if (!cases.some((item) => item.status !== 'excluded'))
    errors.push('Suite has no compatible selected cases');
  return {
    valid: errors.length === 0 && cases.every((item) => item.status !== 'invalid'),
    suite,
    profile,
    cases,
    errors,
  };
}
export async function validateArtifact(file: string, kind: 'result' | 'trace' | 'manifest') {
  const { ResultSchema, RunManifestSchema } = await import('#contracts/result');
  const { TraceEventSchema } = await import('#contracts/trace');
  if (kind === 'trace') {
    const lines = (await readFile(file, 'utf8')).trim().split(/\r?\n/);
    let previous = -1;
    let runId: string | undefined;
    let taskId: string | undefined;
    const attempts = new Set<string>();
    const executions = new Set<string>();
    for (const line of lines) {
      const event = TraceEventSchema.parse(JSON.parse(line));
      if (event.sequence !== previous + 1)
        throw new Error('Trace sequences must start at zero and be contiguous');
      if ((runId && runId !== event.runId) || (taskId && taskId !== event.taskId))
        throw new Error('Mixed trace identity');
      runId = event.runId;
      taskId = event.taskId;
      previous = event.sequence;
      if (event.type === 'tool-attempt') {
        if (attempts.has(event.callId)) throw new Error('Duplicate tool call ID');
        attempts.add(event.callId);
      }
      if (event.type === 'tool-executed') {
        if (!attempts.has(event.callId)) throw new Error('Execution without an attempt');
        executions.add(event.callId);
      }
      if (event.type === 'effect-committed' && !executions.has(event.callId))
        throw new Error('Committed effect without executed tool');
    }
    return { kind, events: lines.length };
  }
  const parsed = (kind === 'result' ? ResultSchema : RunManifestSchema).parse(await readJson(file));
  if (kind === 'manifest') {
    const manifest = RunManifestSchema.parse(parsed);
    unique(
      manifest.cases.map((c) => `${c.taskId}:${c.trial}`),
      'manifest trials',
    );
    for (const row of manifest.cases)
      if (row.trial >= manifest.repeats) throw new Error('Trial exceeds configured repeats');
    const counts = new Map<string, number>();
    for (const row of manifest.cases) counts.set(row.taskId, (counts.get(row.taskId) ?? 0) + 1);
    if ([...counts.values()].some((n) => n !== manifest.repeats))
      throw new Error('Manifest silently omits selected repeats');
  } else
    unique(
      ResultSchema.parse(parsed).criteria.map((c) => c.id),
      'result criteria',
    );
  return { kind, valid: true };
}
