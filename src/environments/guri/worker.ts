// @ts-expect-error generated from the pinned schema by prepareGuri
import { PrismaClient } from '@prisma/client';
// @ts-expect-error private canonical principal/access vocabulary
import { userPrincipal } from '@guri/lib/domain/principal.ts';
// @ts-expect-error private canonical error vocabulary
import { isDomainError } from '@guri/lib/domain/errors.ts';
// @ts-expect-error private canonical requirements command
import * as requirements from '@guri/lib/domain/projects/requirements.ts';
// @ts-expect-error private canonical access helper
import { authorizeProject } from '@guri/lib/domain/access/projects.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { GURI_EFFECTS, guriTool, parseGuriArguments } from '#src/environments/guri/tools';
import { stableJson } from '#src/environments/session';
import { sha256 } from '#src/io';
import { redact } from '#src/config';
import { StaleVersionControlSchema, BridgeControlsSchema } from '#contracts/operational';
import {
  DurableRecordingProvider,
  PortUnavailableError,
} from '#src/environments/guri/recording-provider';
import {
  canonicalRead,
  canonicalWrite,
  canonicalOwnedWrite,
  canonicalAfterCommit,
  CanonicalResultRefusal,
} from '#src/environments/guri/commands';

const OWNED = new Set(['send_compliance_outreach', 'recall_offer_envelope', 'update_team_role']);
const { getProjectRequirements, updateProjectRequirements } = requirements;
async function main() {
  let bytes = '';
  for await (const chunk of process.stdin) {
    bytes += String(chunk);
    if (bytes.length > 50_000) throw new Error('RPC_LIMIT');
  }
  const request = JSON.parse(bytes);
  if (request.protocolVersion !== '2.0.0') throw new Error('RPC_VERSION');
  const controls = BridgeControlsSchema.parse({
    schemaVersion: '1.0.0',
    mode: request.mode,
    ports: request.ports,
    fault: request.fault,
    staleVersion: request.control,
  });
  if (
    controls.mode !== 'offline-control' &&
    (controls.fault ||
      controls.staleVersion ||
      controls.ports.email !== 'unavailable' ||
      controls.ports.envelope !== 'unavailable')
  )
    throw new Error('RPC_CONTROL_MODE');
  if (!/^[a-f0-9]{64}$/.test(request.workerHash)) throw new Error('RPC_FINGERPRINT');
  if (!/^[a-f0-9]{64}$/.test(request.runtimeFingerprint)) throw new Error('RPC_FINGERPRINT');
  const url = new URL(request.databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^\/royal_lab_run_[a-f0-9]{32}$/.test(url.pathname)
  )
    throw new Error('DATABASE_DENIED');
  if (!request.ownerId || !request.sessionId || !request.callId) throw new Error('RPC_IDENTITY');
  const clock = Date.parse(request.clock);
  if (!Number.isFinite(clock)) throw new Error('RPC_CLOCK');
  const NativeDate = Date;
  class FrozenDate extends NativeDate {
    constructor(value?: string | number) {
      super(value ?? clock);
    }
    static now() {
      return clock;
    }
  }
  globalThis.Date = FrozenDate as DateConstructor;
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: request.databaseUrl }),
    transactionOptions: { maxWait: 5000, timeout: 10_000 },
  });
  try {
    const markers = await db.$queryRawUnsafe('SELECT "purpose" FROM "RoyalLabFixtureMetadata"');
    if (markers[0]?.purpose !== 'royal-lab-synthetic-only-v1') throw new Error('DATABASE_DENIED');
    const actor = await db.user.findUnique({ where: { id: request.ownerId } });
    if (!actor) throw new Error('RPC_IDENTITY');
    const principal = userPrincipal(actor);
    if (request.control) {
      const control = StaleVersionControlSchema.parse(request.control);
      const key = `${request.sessionId}:${control.injectionId}`;
      const binding = sha256(stableJson(control));
      return await db.$transaction(
        async (tx: any) => {
          await lock(tx, key);
          const previous = await tx.$queryRawUnsafe(
            'SELECT * FROM "RoyalLabControlInjection" WHERE "key"=$1',
            key,
          );
          if (previous[0]) {
            if (previous[0].binding !== binding) throw new Error('CONTROL_BINDING_CONFLICT');
            return { status: 'control-replayed', result: null };
          }
          await authorizeProject(principal, control.projectId, tx);
          const before = await getProjectRequirements(control.projectId, tx);
          await updateProjectRequirements(
            {
              projectId: control.projectId,
              expectedUpdatedAt: before.updatedAt,
              patch: control.patch,
            },
            tx,
          );
          const after = await getProjectRequirements(control.projectId, tx);
          if (after.updatedAt === before.updatedAt) throw new Error('CONTROL_VERSION_UNCHANGED');
          await tx.$executeRawUnsafe(
            'INSERT INTO "RoyalLabControlInjection" ("key","binding","kind","before","after") VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)',
            key,
            binding,
            'controller-stale-version',
            JSON.stringify(before),
            JSON.stringify(after),
          );
          return { status: 'control-applied', result: null };
        },
        { isolationLevel: 'Serializable' },
      );
    }
    const tool = guriTool(request.tool);
    const args = parseGuriArguments(tool, request.arguments);
    if (GURI_EFFECTS[tool] === 'read')
      return { status: 'success', result: await canonicalRead(tool, args, principal, db) };
    const approvalBinding = sha256(
      stableJson({
        sessionId: request.sessionId,
        ownerId: request.ownerId,
        callId: request.callId,
        tool,
        arguments: args,
      }),
    );
    if (request.approvalBinding !== approvalBinding) throw new Error('APPROVAL_REQUIRED');
    const configuration = {
      protocolVersion: request.protocolVersion,
      workerHash: request.workerHash,
      runtimeFingerprint: request.runtimeFingerprint,
      ports: controls.ports,
      clock: request.clock,
      mode: controls.mode,
    };
    const binding = sha256(stableJson({ approvalBinding, configuration }));
    const key = `${request.sessionId}:${request.callId}:${tool}`;
    const ports = new DurableRecordingProvider(db, key, request.ports);
    const fault = async (point: string, tx = db) => {
      if (request.fault?.tool !== tool || request.fault.point !== point) return;
      if (request.fault.mode === 'error') throw new Error('CONTROL_INJECTED_FAILURE');
      await tx.$queryRawUnsafe('SELECT pg_sleep(60)::text');
    };
    if (OWNED.has(tool)) {
      const claimed = await db.$executeRawUnsafe(
        'INSERT INTO "RoyalLabOperation" ("key","binding","status","configuration") VALUES ($1,$2,\'running\',$3::jsonb) ON CONFLICT ("key") DO NOTHING',
        key,
        binding,
        JSON.stringify(configuration),
      );
      if (!claimed)
        return replay(
          await db.$queryRawUnsafe('SELECT * FROM "RoyalLabOperation" WHERE "key"=$1', key),
          binding,
        );
      try {
        await fault('before-dispatch');
        const result = await canonicalOwnedWrite(tool, args, principal, db, ports, key);
        await fault('after-write');
        await db.$executeRawUnsafe(
          'UPDATE "RoyalLabOperation" SET "status"=\'committed\',"result"=$2::jsonb WHERE "key"=$1',
          key,
          JSON.stringify(result),
        );
        await canonicalAfterCommit(tool, args, result, db);
        return { status: 'committed', result };
      } catch (error) {
        process.stderr.write(
          String(redact(error instanceof Error ? error.message : error)).slice(0, 2000),
        );
        const response = refusal(error);
        await db.$executeRawUnsafe(
          'UPDATE "RoyalLabOperation" SET "status"=$2,"result"=$3::jsonb WHERE "key"=$1 AND "status"=\'running\'',
          key,
          response.status === 'error' ? 'uncertain' : 'refused',
          JSON.stringify(response),
        );
        return response;
      }
    }
    const outcome = await db.$transaction(
      async (tx: any) => {
        await lock(tx, key);
        const previous = await tx.$queryRawUnsafe(
          'SELECT * FROM "RoyalLabOperation" WHERE "key"=$1 FOR UPDATE',
          key,
        );
        if (previous[0]) return replay(previous, binding);
        await fault('before-dispatch', tx);
        const result = await canonicalWrite(tool, args, principal, tx);
        await fault('after-write', tx);
        await tx.$executeRawUnsafe(
          'INSERT INTO "RoyalLabOperation" ("key","binding","status","result","configuration") VALUES ($1,$2,\'committed\',$3::jsonb,$4::jsonb)',
          key,
          binding,
          JSON.stringify(result),
          JSON.stringify(configuration),
        );
        return { status: 'committed', result };
      },
      { isolationLevel: 'Serializable' },
    );
    if (outcome.status === 'committed') await canonicalAfterCommit(tool, args, outcome.result, db);
    return outcome;
  } finally {
    await db.$disconnect();
  }
}
async function lock(tx: any, key: string) {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text AS lock',
    key,
  );
}
function replay(rows: any[], binding: string) {
  if (rows[0]?.binding !== binding) throw new Error('OPERATION_CONFLICT');
  if (rows[0].status !== 'committed')
    throw new Error('OPERATION_UNCERTAIN: independent reconciliation required');
  return { status: 'replayed', result: rows[0].result };
}
function refusal(error: unknown) {
  if (error instanceof CanonicalResultRefusal)
    return {
      status: error.reason === 'stale' ? 'stale-version' : 'domain-refusal',
      result: error.result,
    };
  if (isDomainError(error))
    return {
      status: (error as any).code === 'domain_stale_version' ? 'stale-version' : 'domain-refusal',
      result: { error: (error as Error).message, code: (error as any).code },
    };
  if (error instanceof PortUnavailableError)
    return { status: 'unsupported', result: { error: error.message } };
  return {
    status: 'error',
    result: { error: 'Trusted RPC or infrastructure failure; independent verification required.' },
  };
}
main()
  .then((result) => process.stdout.write(JSON.stringify(result)))
  .catch((error: unknown) => {
    process.stderr.write(
      String(redact(error instanceof Error ? error.message : error)).slice(0, 2000),
    );
    process.stdout.write(JSON.stringify(refusal(error)));
    process.exitCode = 2;
  });
