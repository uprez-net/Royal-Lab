// Only the build plugin resolves these imports from the clean, pinned private checkout.
// @ts-expect-error private source is deliberately outside Royal-Lab's TypeScript graph
import { createLeadTask, listOpenTasks } from '@guri/lib/domain/leads/tasks.ts';
// @ts-expect-error private canonical access helper
import { authorizeLead, leadListScope } from '@guri/lib/domain/access/leads.ts';
// @ts-expect-error generated from the pinned schema by prepareGuri
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash } from 'node:crypto';
import { GURI_TOOL_SCHEMAS, guriTool } from '#src/environments/guri/tools';
import { stableJson } from '#src/environments/session';
import { redact } from '#src/config';

async function main() {
  let bytes = '';
  for await (const chunk of process.stdin) {
    bytes += String(chunk);
    if (bytes.length > 50_000) throw new Error('RPC_LIMIT');
  }
  const request = JSON.parse(bytes);
  const tool = guriTool(request.tool);
  const args = GURI_TOOL_SCHEMAS[tool].parse(request.arguments);
  const url = new URL(request.databaseUrl);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^\/royal_lab_run_[a-f0-9]{32}$/.test(url.pathname)
  )
    throw new Error('DATABASE_DENIED');
  if (request.ownerId !== 'builder-owner' || !request.sessionId || !request.callId)
    throw new Error('RPC_IDENTITY');
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: request.databaseUrl }),
    transactionOptions: { maxWait: 5000, timeout: 10_000 },
  });
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
  // Trusted, per-call process: freeze domain helper wall time without changing the product.
  globalThis.Date = FrozenDate as DateConstructor;
  const principal = { kind: 'user', userId: request.ownerId, role: 'ADMIN' };
  try {
    if (tool === 'find_leads') {
      const scope = leadListScope(principal);
      const query = (args as { query: string }).query;
      const result = await db.lead.findMany({
        where: {
          ...(scope.assignedId ? { assignedId: scope.assignedId } : {}),
          name: { contains: query, mode: 'insensitive' },
        },
        select: { id: true, name: true, stage: true, email: true },
        orderBy: { id: 'asc' },
        take: 30,
      });
      return { status: 'success', result };
    }
    const leadId = (args as { leadId: number }).leadId;
    await authorizeLead(principal, leadId, db);
    if (tool === 'list_lead_tasks')
      return { status: 'success', result: await listOpenTasks(db, { leadIds: [leadId] }) };
    const binding = createHash('sha256')
      .update(
        stableJson({
          sessionId: request.sessionId,
          ownerId: request.ownerId,
          callId: request.callId,
          tool,
          arguments: args,
        }),
      )
      .digest('hex');
    if (request.approvalBinding !== binding) throw new Error('APPROVAL_REQUIRED');
    const key = `${request.sessionId}:${request.callId}:${tool}`;
    return await db.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text AS lock',
        key,
      );
      const previous = await tx.$queryRawUnsafe(
        'SELECT * FROM "RoyalLabOperation" WHERE "key"=$1 FOR UPDATE',
        key,
      );
      if (previous[0]) {
        if (previous[0].binding !== binding || previous[0].status !== 'committed')
          throw new Error('OPERATION_CONFLICT');
        return { status: 'replayed', result: previous[0].result };
      }
      const input = args as {
        leadId: number;
        type: string;
        dueDate: string;
        dueTime: string | null;
        notes: string | null;
      };
      const result = await createLeadTask(
        {
          ...input,
          dueDate: new NativeDate(`${input.dueDate}T00:00:00Z`),
          actingUserId: request.ownerId,
        },
        tx,
      );
      await tx.$executeRawUnsafe(
        'INSERT INTO "RoyalLabOperation" ("key","binding","status","result") VALUES ($1,$2,$3,$4::jsonb)',
        key,
        binding,
        'committed',
        JSON.stringify(result),
      );
      return { status: 'committed', result };
    });
  } finally {
    await db.$disconnect();
  }
}
main()
  .then((result) => process.stdout.write(JSON.stringify(result)))
  .catch((error: unknown) => {
    process.stderr.write(
      String(redact(error instanceof Error ? error.message : error)).slice(0, 2000),
    );
    // Avoid returning driver messages containing credentials or host paths to the candidate.
    const refusal =
      error instanceof Error &&
      [
        'DomainTransitionError',
        'DomainAuthorizationError',
        'DomainNotFoundError',
        'LeadTaskRejectedError',
      ].includes(error.name);
    process.stdout.write(
      JSON.stringify({
        status: refusal ? 'domain-refusal' : 'error',
        result: {
          error: refusal
            ? 'Canonical domain refusal.'
            : 'Trusted RPC or infrastructure failure; independent verification required.',
        },
      }),
    );
    process.exitCode = 2;
  });
