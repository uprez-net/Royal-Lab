// Shared helpers for the Builder Review Desk scripts. The static page lives in
// site/review-desk; content and answers live in private Vercel Blob.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '../..');
export const CONTENT_PATH = 'content/desk.json';
export const FILE_TYPES = ['profile', 'labels', 'reviews', 'proposals'];
export const filePath = (builder, type) => `${builder}/${type}/${type}.json`;
// GitHub Pages for this repository (see .github/workflows/review-desk-pages.yml).
export const SITE_URL = process.env.REVIEW_DESK_URL || 'https://uprez-net.github.io/Royal-Lab/';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const slug = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unnamed';

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) out._.push(a);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

// Reads only BLOB_READ_WRITE_TOKEN; the rest of .env is never loaded.
export function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const file = path.join(root, '.env');
  const line = existsSync(file)
    ? readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .find((l) => /^\s*BLOB_READ_WRITE_TOKEN\s*=/.test(l))
    : undefined;
  const token = line
    ?.replace(/^\s*BLOB_READ_WRITE_TOKEN\s*=\s*/, '')
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not set in the environment or .env');
  return token;
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Everything a reviewer reads: the 16 unlabelled calibration examples and the
// 52 task packs (brief, candidate documents, policy, expectations, controls).
export function buildContent() {
  const tasksDir = path.join(root, 'tasks');
  const policies = {};
  const packs = [];
  for (const file of walk(tasksDir)
    .filter((f) => path.basename(f) === 'task.json')
    .sort()) {
    const dir = path.dirname(file);
    const task = readJson(file);
    const files = walk(dir).sort();
    const contentHash = sha256(
      files
        .map((f) => `${path.relative(dir, f).replaceAll('\\', '/')}\n${sha256(readFileSync(f))}`)
        .join('\n'),
    );
    const documents = [];
    let policyKey = null;
    for (const input of task.inputs) {
      const text = readFileSync(path.join(dir, input.path), 'utf8');
      if (input.kind === 'policy') {
        policyKey = sha256(text).slice(0, 16);
        policies[policyKey] ??= {
          version: (text.match(/v([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1] ?? null,
          text,
        };
        continue;
      }
      documents.push({
        id: input.id,
        name: path.basename(input.path),
        mediaType: input.mediaType,
        text,
      });
    }
    const rubric = readJson(path.join(dir, task.rubricPath));
    const controls = task.controlsPath ? readJson(path.join(dir, task.controlsPath)).controls : [];
    const environmentFile = path.join(dir, 'grading', 'environment.json');
    packs.push({
      key: task.id.replaceAll('/', '--'),
      taskId: task.id,
      title: task.title,
      family: task.id.split('/')[0],
      definitionId: task.definitionId,
      role: task.role,
      version: task.version,
      world: task.worldId,
      clock: task.clock,
      jurisdiction: task.jurisdiction,
      instruction: task.instruction,
      deliverables: task.deliverables.map((d) => ({ path: d.path, description: d.description })),
      allowedOutcomes: task.allowedOutcomes,
      documents,
      policyKey,
      criteria: rubric.criteria.map((c) => ({
        id: c.id,
        title: c.title,
        mandatory: c.mandatory,
        severity: c.severity,
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
      })),
      controls: controls.map((c) => ({
        id: c.id,
        kind: c.kind,
        description: c.description,
        fails: Object.entries(c.expected)
          .filter(([, v]) => v === 'fail')
          .map(([k]) => k),
      })),
      environment: existsSync(environmentFile)
        ? JSON.stringify(readJson(environmentFile), null, 2)
        : null,
      contentHash,
    });
  }
  const pack = readJson(path.join(root, 'fixtures/judge-calibration/labelling-pack.json'));
  const examples = pack.examples.map((e, i) => {
    if (e.label !== null) throw new Error(`labelled example in calibration pack: ${e.id}`);
    return {
      id: e.id,
      order: i + 1,
      taskId: e.taskId,
      criterion: e.scope.criterion,
      sources: e.scope.sources,
      deliverables: e.scope.deliverables,
      evidenceHash: e.evidenceHash,
    };
  });
  return {
    schemaVersion: 1,
    calibrationPack: `${pack.id}@${pack.version}`,
    examples,
    policies,
    packs,
  };
}
