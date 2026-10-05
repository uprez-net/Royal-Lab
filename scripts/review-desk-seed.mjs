// Builds the Builder Review Desk seed documents (read-only over the repo).
// Usage: node scripts/review-desk-seed.mjs <repo-root> <out-dir>; then load
// out-dir/{meta,calibration,policies,packs}/*.json into the page database.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const repo = process.argv[2];
const out = process.argv[3];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const rel = (...p) => path.join(repo, ...p);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const key = (id) => id.replaceAll('/', '~');
for (const d of ['packs', 'policies', 'calibration', 'meta'])
  mkdirSync(path.join(out, d), { recursive: true });

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const taskFiles = walk(rel('tasks')).filter((f) => path.basename(f) === 'task.json');
const policies = new Map();
const index = [];
for (const file of taskFiles.sort()) {
  const dir = path.dirname(file);
  const task = json(file);
  const files = walk(dir).sort();
  const contentHash = sha(
    files
      .map((f) => `${path.relative(dir, f).replaceAll('\\', '/')}\n${sha(readFileSync(f))}`)
      .join('\n'),
  );
  const documents = [];
  let policyKey = null;
  for (const input of task.inputs) {
    const text = readFileSync(path.join(dir, input.path), 'utf8');
    if (input.kind === 'policy') {
      policyKey = sha(text).slice(0, 16);
      if (!policies.has(policyKey)) {
        const version = (text.match(/v([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1] ?? null;
        policies.set(policyKey, { key: policyKey, version, sha256: sha(text), text });
      }
      continue;
    }
    documents.push({
      id: input.id,
      name: path.basename(input.path),
      mediaType: input.mediaType,
      text,
    });
  }
  const rubric = json(path.join(dir, task.rubricPath));
  const criteria = rubric.criteria.map((c) => ({
    id: c.id,
    title: c.title,
    mandatory: c.mandatory,
    severity: c.severity,
    category: c.category,
    method: c.method,
    expected:
      c.method === 'deterministic'
        ? {
            deliverable: c.check.deliverable ?? null,
            field: c.check.pointer ?? c.check.path ?? null,
            value: JSON.stringify(c.check.expected ?? c.check),
          }
        : null,
    passIf: c.passIf ?? null,
    failIf: c.failIf ?? null,
    evidence: (c.evidence ?? []).map((e) => ({
      sourceId: e.sourceId,
      locator: e.locator,
      fact: e.fact,
    })),
  }));
  const controls = (task.controlsPath ? json(path.join(dir, task.controlsPath)).controls : []).map(
    (c) => {
      const by = (v) =>
        Object.entries(c.expected)
          .filter(([, x]) => x === v)
          .map(([k]) => k);
      return {
        id: c.id,
        kind: c.kind,
        description: c.description,
        fails: by('fail'),
        passes: by('pass').length,
      };
    },
  );
  const envPath = path.join(dir, 'grading', 'environment.json');
  let environment = existsSync(envPath) ? JSON.stringify(json(envPath), null, 2) : null;
  if (environment && environment.length > 60000)
    environment = environment.slice(0, 60000) + '\n… (truncated)';
  const [family] = task.id.split('/');
  const doc = {
    taskId: task.id,
    key: key(task.id),
    title: task.title,
    family,
    definitionId: task.definitionId,
    role: task.role,
    variantOf: task.variantOf,
    version: task.version,
    world: task.worldId,
    clock: task.clock,
    jurisdiction: task.jurisdiction,
    profiles: task.profiles,
    instruction: task.instruction,
    deliverables: task.deliverables.map((d) => ({ path: d.path, description: d.description })),
    allowedOutcomes: task.allowedOutcomes,
    operatorBranches: task.operatorBranches ?? [],
    documents,
    policyKey,
    criteria,
    controls,
    environment,
    contentHash,
  };
  const body = JSON.stringify(doc);
  if (body.length > 250000) throw new Error(`too large: ${task.id} ${body.length}`);
  writeFileSync(path.join(out, 'packs', `${doc.key}.json`), body);
  index.push({
    key: doc.key,
    taskId: task.id,
    title: task.title,
    family,
    definitionId: task.definitionId,
    role: task.role,
    world: task.worldId,
    version: task.version,
  });
}
for (const p of policies.values())
  writeFileSync(path.join(out, 'policies', `${p.key}.json`), JSON.stringify(p));

const pack = json(rel('fixtures/judge-calibration/labelling-pack.json'));
pack.examples.forEach((e, i) => {
  if (e.label !== null) throw new Error('labelled example in pack');
  writeFileSync(
    path.join(out, 'calibration', `${e.id}.json`),
    JSON.stringify({
      id: e.id,
      order: i + 1,
      taskId: e.taskId,
      criterion: e.scope.criterion,
      sources: e.scope.sources,
      deliverables: e.scope.deliverables,
      evidenceHash: e.evidenceHash,
    }),
  );
});
writeFileSync(
  path.join(out, 'meta', 'info.json'),
  JSON.stringify({
    calibrationPack: `${pack.id}@${pack.version}`,
    calibrationCount: pack.examples.length,
    packCount: index.length,
    packs: index,
    seededAt: new Date().toISOString(),
  }),
);
console.log({ packs: index.length, policies: policies.size, calibration: pack.examples.length });
