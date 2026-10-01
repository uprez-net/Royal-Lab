import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { lockGuriSource } from '#src/environments/guri/source-lock';
import { sha256, jsonText } from '#src/io';
import { Hash, Review } from '#contracts/common';
export const OracleSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  helper: z.literal('calculateOfferWorkspacePricing'),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  sourceHashes: z.array(z.strictObject({ path: z.string(), sha256: Hash })),
  generatorVersion: z.literal('1.0.0'),
  inputHash: Hash,
  input: z.json(),
  outputHash: Hash,
  output: z.json(),
  units: z.literal('AUD dollars; transform to integer cents explicitly'),
  review: Review,
});
// Authoring-only boundary. Generated numbers remain draft until independently reviewed.
// No production template, model client, database adapter or workflow implementation is copied.
export async function generatePricingOracle(
  root: string,
  checkout: string,
  syntheticInput: unknown,
) {
  const input = z
    .strictObject({
      directTotal: z.number().nonnegative(),
      totalAreaSqm: z.number().nonnegative(),
      settings: z.strictObject({
        royalConstructionOverheadPct: z.number().nonnegative(),
        royalConstructionFeePct: z.number().nonnegative(),
        gstRate: z.number().nonnegative(),
        hbcfTotalContractValue: z.number().nonnegative(),
        hbcfRate: z.number().nonnegative(),
        homeWarrantyHbcfFixed: z.number().nonnegative(),
        impactFeeFixed: z.number().nonnegative(),
        loadingChargePercentage: z.number().nonnegative(),
      }),
    })
    .parse(syntheticInput);
  const lock = await lockGuriSource(checkout);
  const directory = path.join(root, '.cache/oracles');
  await mkdir(directory, { recursive: true });
  const outputFile = path.join(directory, `pricing-${sha256(jsonText(input))}.mjs`);
  const bundle = await build({
    stdin: {
      contents:
        'import {calculateOfferWorkspacePricing} from "@/lib/offer/workspace-pricing"; let input=""; for await(const chunk of process.stdin) input+=chunk; console.log(JSON.stringify(calculateOfferWorkspacePricing(JSON.parse(input))));',
      resolveDir: lock.root,
      loader: 'ts',
    },
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    metafile: true,
    plugins: [
      {
        name: 'pure-offer-leaves',
        setup(builder) {
          builder.onResolve({ filter: /^@\// }, (args) => ({
            path: path.join(lock.root, `${args.path.slice(2)}.ts`),
          }));
          builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
            if (!args.path.startsWith(path.join(lock.root, 'lib/offer') + path.sep))
              throw new Error('ORACLE_UNSUPPORTED_IMPORT');
            return { contents: await readFile(args.path, 'utf8'), loader: 'ts' };
          });
        },
      },
    ],
  });
  const sourceHashes = [];
  for (const file of Object.keys(bundle.metafile!.inputs).filter((file) => file !== '<stdin>')) {
    const absolute = path.resolve(file);
    sourceHashes.push({
      path: path.relative(lock.root, absolute).replace(/\\/g, '/'),
      sha256: sha256(await readFile(absolute)),
    });
  }
  await lockGuriSource(checkout);
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [outputFile],
      {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 100000,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      },
      (error, stdout) => (error ? reject(new Error('ORACLE_EXECUTION_FAILED')) : resolve(stdout)),
    );
    child.stdin!.on('error', reject);
    child.stdin!.end(JSON.stringify(input));
  });
  const parsed = JSON.parse(output);
  const artifact = OracleSchema.parse({
    schemaVersion: '1.0.0',
    helper: 'calculateOfferWorkspacePricing',
    sourceRevision: lock.revision,
    sourceHashes,
    generatorVersion: '1.0.0',
    inputHash: sha256(jsonText(input)),
    input,
    outputHash: sha256(jsonText(parsed)),
    output: parsed,
    units: 'AUD dollars; transform to integer cents explicitly',
    review: {
      status: 'draft',
      reviewer: null,
      reviewedAt: null,
      notes:
        'Canonical helper executed on original synthetic inputs. Independent builder review remains pending.',
    },
  });
  await writeFile(path.join(directory, `pricing-${artifact.inputHash}.json`), jsonText(artifact));
  return artifact;
}
