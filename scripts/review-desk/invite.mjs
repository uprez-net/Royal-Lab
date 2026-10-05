// Creates a personal Builder Review Desk link for one reviewer.
// The link carries a presigned read URL for a private invite file. That file
// holds presigned URLs scoped to exact pathnames: read access to
// content/desk.json, and read/overwrite access to the reviewer's own four
// files at {builder}/{type}/{type}.json. No token reaches the browser; a link
// grants nothing beyond those files and expires with --days (at most 7). Re-running for the same name
// issues a fresh link to the same folder, so answers carry over.
// Usage: pnpm review-desk:invite --name "Jane Citizen" [--business "…"] [--days 7] [--site URL]
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { issueSignedToken, presignUrl, put } from '@vercel/blob';
import {
  CONTENT_PATH,
  FILE_TYPES,
  SITE_URL,
  args,
  blobToken,
  filePath,
  readJson,
  root,
  slug,
} from './lib.mjs';

const opts = args();
if (!opts.name || opts.name === true)
  throw new Error('usage: review-desk:invite --name "Jane Citizen" [--business "…"] [--days 7]');
// Vercel caps signed delegations at 7 days; re-run for the same name to renew.
const days = Number(opts.days ?? 7);
if (!Number.isFinite(days) || days <= 0 || days > 7)
  throw new Error('--days must be between 1 and 7 (the Vercel Blob limit)');
const site = typeof opts.site === 'string' ? opts.site : SITE_URL;
const token = blobToken();

const registryFile = path.join(root, 'review-desk/invites.json');
const registry = existsSync(registryFile) ? readJson(registryFile) : { invites: [] };
// One folder per person: a name already used by someone else gets a numeric suffix.
const base = slug(opts.name);
let builder = typeof opts.builder === 'string' ? slug(opts.builder) : base;
const owner = (b) => registry.invites.find((i) => i.builder === b);
for (let n = 2; owner(builder) && owner(builder).name !== opts.name; n++) builder = `${base}-${n}`;

const issuedAt = new Date();
const validUntil = issuedAt.getTime() + days * 24 * 60 * 60 * 1000;
const sign = async (pathname, operations, extra = {}) => {
  const delegation = await issueSignedToken({ token, pathname, operations, validUntil, ...extra });
  const urls = {};
  if (operations.includes('get'))
    urls.get = (
      await presignUrl(delegation, { operation: 'get', pathname, access: 'private' })
    ).presignedUrl;
  if (operations.includes('put'))
    urls.put = (
      await presignUrl(delegation, {
        operation: 'put',
        pathname,
        access: 'private',
        allowOverwrite: true,
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      })
    ).presignedUrl;
  return urls;
};

const files = {};
for (const type of FILE_TYPES)
  files[type] = await sign(filePath(builder, type), ['get', 'put'], {
    allowedContentTypes: ['application/json'],
    maximumSizeInBytes: 4 * 1024 * 1024,
  });
const bundle = {
  schemaVersion: 1,
  builder,
  name: opts.name,
  business: typeof opts.business === 'string' ? opts.business : null,
  issuedAt: issuedAt.toISOString(),
  validUntil: new Date(validUntil).toISOString(),
  content: (await sign(CONTENT_PATH, ['get'])).get,
  files,
};
const inviteId = randomBytes(12).toString('hex');
const invitePath = `invites/${inviteId}.json`;
await put(invitePath, JSON.stringify(bundle), {
  access: 'private',
  token,
  contentType: 'application/json',
  addRandomSuffix: false,
  allowOverwrite: false,
});
const inviteUrl = (await sign(invitePath, ['get'])).get;
const link = `${site}#invite=${encodeURIComponent(inviteUrl)}`;

registry.invites.push({
  builder,
  name: opts.name,
  business: bundle.business,
  inviteId,
  issuedAt: bundle.issuedAt,
  validUntil: bundle.validUntil,
});
mkdirSync(path.dirname(registryFile), { recursive: true });
writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
console.log(
  `Invite for ${opts.name} (folder ${builder}/), valid until ${bundle.validUntil}:\n\n${link}\n`,
);
console.log(
  "Send this link privately. Anyone holding it can read the task content and edit this reviewer's answers until it expires.",
);
