// Uploads the reviewer-visible content (calibration examples and task packs)
// to private Vercel Blob at content/desk.json. Re-run after packs change;
// existing invite links keep working because the pathname is fixed.
// Usage: pnpm review-desk:content [--dry-run]
import { put } from '@vercel/blob';
import { CONTENT_PATH, args, blobToken, buildContent, sha256 } from './lib.mjs';

const opts = args();
const content = { ...buildContent(), publishedAt: new Date().toISOString() };
const body = JSON.stringify(content);
console.log(
  `${content.examples.length} calibration examples, ${content.packs.length} packs, ` +
    `${Object.keys(content.policies).length} policies, ${(body.length / 1024).toFixed(0)} KiB, ` +
    `sha256 ${sha256(body).slice(0, 12)}`,
);
if (opts['dry-run']) process.exit(0);
await put(CONTENT_PATH, body, {
  access: 'private',
  token: blobToken(),
  contentType: 'application/json',
  addRandomSuffix: false,
  allowOverwrite: true,
  cacheControlMaxAge: 60,
});
console.log(`uploaded ${CONTENT_PATH}`);
