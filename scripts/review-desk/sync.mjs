// Pulls Builder Review Desk answers from private Vercel Blob into the repo at
// review-desk/submissions/{builder}/{type}/{type}.json. When a reviewer has
// submitted all 16 labels it also writes labels/calibration-labels.json in the
// shape `pnpm lab calibration-record --labels` reads. Content and invite files
// are never downloaded. Submissions are reviewer input, not recorded reviews.
// Usage: pnpm review-desk:sync [--dry-run]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { get, list } from '@vercel/blob';
import { FILE_TYPES, args, blobToken, readJson, root } from './lib.mjs';

const opts = args();
const token = blobToken();
const outDir = path.join(root, 'review-desk/submissions');
const pattern = new RegExp(`^([a-z0-9-]+)/(${FILE_TYPES.join('|')})/\\2\\.json$`);

const blobs = [];
let cursor;
do {
  const page = await list({ token, cursor, limit: 1000 });
  blobs.push(...page.blobs);
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);
const wanted = blobs.filter((b) => pattern.test(b.pathname));

const pack = readJson(path.join(root, 'fixtures/judge-calibration/labelling-pack.json'));
const exampleIds = pack.examples.map((e) => e.id);
const writes = [];
const write = (rel, text) => {
  const file = path.join(outDir, rel);
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
  writes.push(rel);
  if (opts['dry-run']) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const byBuilder = new Map();
for (const blob of wanted) {
  const [, builder, type] = blob.pathname.match(pattern);
  const res = await get(blob.pathname, { access: 'private', token, useCache: false });
  if (!res || res.statusCode !== 200) continue;
  const data = JSON.parse(await new Response(res.stream).text());
  write(blob.pathname, `${JSON.stringify(data, null, 2)}\n`);
  if (!byBuilder.has(builder)) byBuilder.set(builder, {});
  byBuilder.get(builder)[type] = data;
}

for (const [builder, files] of byBuilder) {
  const labels = files.labels;
  const items = labels?.items ?? {};
  const complete = exampleIds.every((id) => ['pass', 'fail'].includes(items[id]?.label));
  if (!labels?.submittedAt || !complete) continue;
  const p = files.profile ?? {};
  const calibration = {
    schemaVersion: '1.0.0',
    pack: `${pack.id}@${pack.version}`,
    reviewer: [p.name, p.role, p.business].filter(Boolean).join(', ') || builder,
    reviewedAt: labels.submittedAt,
    timestampNote:
      'Submitted by the reviewer through the Builder Review Desk; reviewedAt is their submission time.',
    labels: Object.fromEntries(exampleIds.map((id) => [id, items[id].label])),
    notes: Object.fromEntries(
      exampleIds.filter((id) => items[id].note).map((id) => [id, items[id].note]),
    ),
  };
  write(`${builder}/labels/calibration-labels.json`, `${JSON.stringify(calibration, null, 2)}\n`);
}

console.log(
  `${byBuilder.size} reviewer(s), ${wanted.length} file(s) in Blob, ${writes.length} ${opts['dry-run'] ? 'would change' : 'changed'}`,
);
for (const rel of writes) console.log(`  review-desk/submissions/${rel}`);
