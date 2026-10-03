import { build } from 'esbuild';
import { BRIDGE_VERSION } from '#src/environments/guri/bridge';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lockGuriSource } from '#src/environments/guri/source-lock';
import { jsonText, sha256 } from '#src/io';
const exec = promisify(execFile);
export async function prepareGuri(root: string, checkout: string) {
  const lock = await lockGuriSource(checkout);
  const directory = path.join(root, '.cache/guri');
  await mkdir(directory, { recursive: true });
  const schema = (await readFile(path.join(lock.root, 'prisma/schema.prisma'), 'utf8')).replace(
    'provider = "prisma-client-js"',
    'provider = "prisma-client-js"\n  output = "./client"',
  );
  await writeFile(path.join(directory, 'schema.prisma'), schema);
  const configFile = path.join(directory, 'prisma.config.mjs');
  await writeFile(
    configFile,
    `export default {schema:${JSON.stringify(path.join(directory, 'schema.prisma'))},datasource:{url:"postgresql://unused:unused@127.0.0.1:55432/royal_lab_control"}};\n`,
  );
  const cli = path.join(root, 'node_modules/prisma/build/index.js');
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  await exec(process.execPath, [cli, 'generate', '--config', configFile], {
    cwd: root,
    env,
    windowsHide: true,
    maxBuffer: 8_000_000,
  });
  const sql = await exec(
    process.execPath,
    [
      cli,
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema',
      path.join(directory, 'schema.prisma'),
      '--script',
      '--config',
      configFile,
    ],
    { cwd: root, env, windowsHide: true, maxBuffer: 8_000_000 },
  );
  // Prisma's schema diff cannot express this canonical partial index. Import the
  // exact owning migration statement from the pin; never reimplement its rule.
  const constraintPath =
    'prisma/migrations/20260706120000_offer_workspace_persistence/migration.sql';
  const migration = await readFile(path.join(lock.root, constraintPath), 'utf8');
  const statements = migration
    .split(/\r?\n/)
    .filter((line) => line.startsWith('CREATE UNIQUE INDEX "Offer_leadId_active_key" '));
  if (statements.length !== 1 || !statements[0]!.endsWith(';'))
    throw new Error('GURI_CONSTRAINT_MISSING');
  const schemaSql = `${sql.stdout}\n${statements[0]}\n`;
  await writeFile(path.join(directory, 'schema.sql'), schemaSql);
  const workerSource = fileURLToPath(new URL('./worker.ts', import.meta.url));
  // In compiled builds worker.js sits beside this module; source is bundled by esbuild.
  const worker = workerSource.replace(
    /worker\.ts$/,
    import.meta.url.endsWith('.js') ? 'worker.js' : 'worker.ts',
  );
  const bundle = await build({
    entryPoints: [worker],
    outfile: path.join(directory, 'worker.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    metafile: true,
    packages: 'external',
    plugins: [
      {
        name: 'pinned-guri',
        setup(builder) {
          const sourcePath = (base: string) =>
            existsSync(base) ? base : existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
          builder.onResolve({ filter: /^#(src|contracts|fixtures)\// }, (args) => {
            const parts = args.path.slice(1).split('/');
            const prefix = parts.shift()!;
            return {
              path: sourcePath(path.join(root, 'src', prefix === 'src' ? '' : prefix, ...parts)),
            };
          });
          builder.onResolve({ filter: /^@guri\// }, (args) => ({
            path: path.join(lock.root, args.path.slice(6)),
          }));
          builder.onResolve({ filter: /^@\// }, (args) => ({
            path: sourcePath(path.join(lock.root, args.path.slice(2))),
          }));
          builder.onResolve({ filter: /^@prisma\/client$/ }, () => ({
            path: pathToFileURL(path.join(directory, 'client/index.js')).href,
            external: true,
          }));
          builder.onResolve(
            {
              filter:
                /^(next|server-only|dotenv|ai|@ai-sdk|@clerk|@vercel\/blob|xero-node|docusign-esign|@novu|@microsoft\/microsoft-graph-client)(\/|$)/,
            },
            (args) => {
              throw new Error(`GURI_UNSAFE_IMPORT: ${args.path}`);
            },
          );
        },
      },
    ],
    external: ['pg', '@prisma/adapter-pg', 'date-fns', 'date-fns-tz'],
  });
  const files: { path: string; sha256: string }[] = [];
  for (const input of Object.keys(bundle.metafile!.inputs)) {
    const absolute = path.resolve(root, input);
    if (absolute.startsWith(lock.root + path.sep)) {
      const relative = path.relative(lock.root, absolute).replace(/\\/g, '/');
      if (/^(lib\/(prisma|model|data\/acting-user)|app\/|agent\/)/.test(relative))
        throw new Error(`GURI_UNSAFE_GRAPH: ${relative}`);
      files.push({ path: relative, sha256: sha256(await readFile(absolute)) });
    }
  }
  const manifest = {
    bridgeVersion: BRIDGE_VERSION,
    ...lock,
    files,
    workerHash: sha256(await readFile(path.join(directory, 'worker.mjs'))),
    generatedSchemaHash: sha256(schema),
    generatedClientHash: sha256(await readFile(path.join(directory, 'client/index.js'))),
    schemaSqlHash: sha256(schemaSql),
    canonicalSchemaExtensions: [
      {
        path: constraintPath,
        sourceHash: sha256(migration),
        statementHash: sha256(statements[0]!),
      },
    ],
  };
  await writeFile(path.join(directory, 'source-lock.json'), jsonText(manifest));
  return { directory, manifest };
}
