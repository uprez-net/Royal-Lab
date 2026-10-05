// Uploads Builder Review Desk submissions to Vercel Blob (private access).
// Input is a fresh export of the page database's `subs` tree, as written by
// the ArtifactData tool's `out_dir`: <export>/subs/<id>.json plus
// <export>/subs/<id>/{labels,reviews,proposals}/*.json.
// Usage: node scripts/review-desk-sync.mjs <export-dir> [--dry-run] [--force]
// Pathnames: {builder-name}/{type}/{file}. Only BLOB_READ_WRITE_TOKEN is read
// from .env; nothing else from the environment file is loaded.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { put } from '@vercel/blob';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const exportDir = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
if (!exportDir) throw new Error('usage: review-desk-sync.mjs <export-dir> [--dry-run] [--force]');

function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const file = path.join(root, '.env');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*BLOB_READ_WRITE_TOKEN\s*=/.test(l));
  return line
    ? line
        .replace(/^\s*BLOB_READ_WRITE_TOKEN\s*=\s*/, '')
        .replace(/^(['"])(.*)\1$/, '$2')
        .trim()
    : null;
}

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const jsonFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];
// The export spells "~" in a document id as "@" in its file name.
const docId = (file) => file.slice(0, -'.json'.length).replaceAll('@', '~');
const slug = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unnamed';
const sha = (s) => createHash('sha256').update(s).digest('hex');

const pack = readJson(path.join(root, 'fixtures/judge-calibration/labelling-pack.json'));
const packRef = `${pack.id}@${pack.version}`;
const exampleIds = pack.examples.map((e) => e.id);
const subsDir = path.join(exportDir, 'subs');
const reviewers = jsonFiles(subsDir).map((f) => ({
  id: docId(f),
  profile: readJson(path.join(subsDir, f)),
}));

// Builder names can collide; colliding reviewers get a short id suffix.
const counts = new Map();
for (const r of reviewers)
  counts.set(slug(r.profile.name), (counts.get(slug(r.profile.name)) ?? 0) + 1);
for (const r of reviewers) {
  const s = slug(r.profile.name);
  r.builder = counts.get(s) > 1 ? `${s}-${slug(r.id).slice(-6)}` : s;
}

const uploads = [];
const add = (pathname, body) =>
  uploads.push({ pathname, body: `${JSON.stringify(body, null, 2)}\n` });
for (const r of reviewers) {
  const p = r.profile;
  const who = {
    reviewerId: r.id,
    name: p.name ?? null,
    business: p.business ?? null,
    role: p.role ?? null,
  };
  add(`${r.builder}/profile/profile.json`, {
    ...who,
    years: p.years ?? null,
    email: p.email ?? null,
    independent: !!p.independent,
    updatedAt: p.updatedAt ?? null,
  });

  const dir = path.join(subsDir, r.id);
  const labels = Object.fromEntries(
    jsonFiles(path.join(dir, 'labels')).map((f) => [
      docId(f),
      readJson(path.join(dir, 'labels', f)),
    ]),
  );
  if (Object.keys(labels).length) {
    add(`${r.builder}/labels/labels.json`, {
      ...who,
      pack: packRef,
      submittedAt: p.labelsSubmittedAt ?? null,
      labels,
    });
    const complete = exampleIds.every(
      (id) => labels[id]?.label === 'pass' || labels[id]?.label === 'fail',
    );
    if (p.labelsSubmittedAt && complete)
      add(`${r.builder}/labels/calibration-labels.json`, {
        schemaVersion: '1.0.0',
        pack: packRef,
        reviewer: [p.name, p.role, p.business].filter(Boolean).join(', '),
        reviewedAt: p.labelsSubmittedAt,
        timestampNote:
          'Submitted by the reviewer through the Builder Review Desk; reviewedAt is their submission time.',
        labels: Object.fromEntries(exampleIds.map((id) => [id, labels[id].label])),
        notes: Object.fromEntries(
          exampleIds.filter((id) => labels[id].note).map((id) => [id, labels[id].note]),
        ),
      });
  }
  for (const f of jsonFiles(path.join(dir, 'reviews'))) {
    const review = readJson(path.join(dir, 'reviews', f));
    add(`${r.builder}/reviews/${docId(f).replaceAll('~', '--')}.json`, { ...who, ...review });
  }
  for (const f of jsonFiles(path.join(dir, 'proposals')))
    add(`${r.builder}/proposals/${slug(docId(f))}.json`, {
      ...who,
      ...readJson(path.join(dir, 'proposals', f)),
    });
}

const manifestFile = path.join(root, 'tmp/review-desk-sync/manifest.json');
const manifest = existsSync(manifestFile) ? readJson(manifestFile) : {};
const pending = uploads.filter((u) => force || manifest[u.pathname] !== sha(u.body));
console.log(
  `${reviewers.length} reviewer(s), ${uploads.length} file(s), ${pending.length} to upload${dryRun ? ' (dry run)' : ''}`,
);
if (dryRun) {
  for (const u of pending) console.log(`  ${u.pathname}`);
  process.exit(0);
}
const token = blobToken();
if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not set in the environment or .env');
for (const u of pending) {
  await put(u.pathname, u.body, {
    access: 'private',
    token,
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  manifest[u.pathname] = sha(u.body);
  console.log(`  uploaded ${u.pathname}`);
}
mkdirSync(path.dirname(manifestFile), { recursive: true });
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
