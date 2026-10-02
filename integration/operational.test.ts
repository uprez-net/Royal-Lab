import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { DisposableDatabase } from '#src/environments/guri/database';
import { GuriBridge } from '#src/environments/guri/bridge';
import {
  OPERATIONAL_CASE_IDS,
  type OperationalCaseId,
} from '#src/environments/guri/synthetic-seed';
import { parseGuriArguments, guriTool } from '#src/environments/guri/tools';
import { Session } from '#src/environments/session';
import { saveIndependentEvidence } from '#src/environments/guri/evidence';
import { RecordingPorts } from '#src/environments/guri/ports';
import { jsonText, sha256 } from '#src/io';
import { verifyState } from '#src/grading/state';
import { FixedToolsEnvironment } from '#src/environments/fixed-tools';
import type { DocumentWorkspace } from '#src/environments/documents';
import { InteractionScriptSchema, ScriptedOperator } from '#src/harness/operator';

const root = process.cwd();
const CONTROL =
  'postgresql://royal_lab:royal-lab-disposable-only@127.0.0.1:55432/royal_lab_control';
const CLOCK = '2026-10-04T00:30:00Z';
const controls = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0.0',
  mode: 'offline-control',
  ...extra,
});
const approval = (session: Session, tool: string, args: unknown, call: string) => {
  const normalized = parseGuriArguments(guriTool(tool), args);
  session.respond(call, tool, normalized, {
    sessionId: session.id,
    ownerId: session.ownerId,
    decision: 'approved',
  });
};
type Snapshot = Awaited<ReturnType<DisposableDatabase['snapshot']>>;
const rows = (snapshot: Snapshot, collection: string): any[] => (snapshot as any)[collection];
const protectedState = (snapshot: Snapshot) => {
  const {
    operations: _operations,
    portEffects: _ports,
    controlInjections: _injections,
    ...state
  } = snapshot;
  return state;
};
async function fixture(
  id: OperationalCaseId,
  work: (
    db: DisposableDatabase,
    bridge: GuriBridge,
    session: Session,
    before: Snapshot,
    calls: unknown[],
  ) => Promise<void>,
) {
  const db = await DisposableDatabase.create(
    CONTROL,
    await readFile(path.join(root, '.cache/guri/schema.sql'), 'utf8'),
  );
  const calls: unknown[] = [];
  let before: Snapshot | undefined;
  try {
    await db.seedOperational(id);
    before = await db.snapshot();
    for (const collection of [
      'history',
      'operations',
      'activityLogs',
      'offerEvents',
      'portEffects',
      'controlInjections',
      'outbox',
    ])
      assert.equal(
        rows(before, collection).length,
        0,
        `${id}: seeding must not manufacture ${collection}`,
      );
    await work(
      db,
      new GuriBridge(path.join(root, '.guri'), path.join(root, '.cache/guri'), db.url, CLOCK),
      new Session(`control-${id}`, 'builder-owner'),
      before,
      calls,
    );
  } finally {
    try {
      if (before) {
        const directory = path.join(root, 'tmp/operational-controls', db.name);
        await mkdir(directory, { recursive: true });
        await saveIndependentEvidence(directory, db, before, new RecordingPorts());
        const source = await readFile(path.join(root, '.cache/guri/source-lock.json'), 'utf8');
        await writeFile(
          path.join(directory, 'control.json'),
          jsonText({
            schemaVersion: '1.0.0',
            caseId: id,
            mode: 'offline-control',
            review: 'pending',
            sourceLockHash: sha256(source),
            calls,
          }),
          { flag: 'wx' },
        );
        await writeFile(path.join(directory, 'source-lock.json'), source, { flag: 'wx' });
      }
    } finally {
      await db.dispose();
      const observer = new Pool({ connectionString: CONTROL, max: 1 });
      try {
        assert.equal(
          (await observer.query('SELECT datname FROM pg_database WHERE datname=$1', [db.name])).rows
            .length,
          0,
        );
      } finally {
        await observer.end();
      }
    }
  }
}
async function execute(
  bridge: GuriBridge,
  session: Session,
  calls: unknown[],
  tool: string,
  args: unknown,
  call: string,
  approve = false,
) {
  if (approve) approval(session, tool, args, call);
  const result = await bridge.execute(tool, args, session, call);
  calls.push({
    callId: call,
    tool,
    arguments: args,
    controls: bridge.controls,
    response: result,
    diagnostic: bridge.lastDiagnostic,
  });
  return result;
}

test('T03: active revision edits persist once; superseded, stale and changed-call edits cannot overwrite', async () =>
  fixture('T03', async (db, bridge, session, before, calls) => {
    assert.equal(
      (await execute(bridge, session, calls, 'list_offer_revisions', { leadId: 101 }, 'revisions'))
        .status,
      'success',
    );
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'get_offer_details',
          { offerId: 'synthetic-offer' },
          'read',
        )
      ).status,
      'success',
    );
    const args = {
      offerId: 'synthetic-offer',
      expectedStateVersion: 1,
      patch: { draft: { headline: 'Updated synthetic heading' } },
    };
    await assert.rejects(
      bridge.execute('update_offer_details', args, session, 'edit'),
      /APPROVAL_REQUIRED/,
    );
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'update_offer_details',
          { ...args, offerId: 'synthetic-old-offer' },
          'superseded',
          true,
        )
      ).status,
      'domain-refusal',
    );
    const result = await execute(
      bridge,
      session,
      calls,
      'update_offer_details',
      args,
      'edit',
      true,
    );
    assert.equal(result.status, 'committed', JSON.stringify(result));
    const after = await db.snapshot();
    assert.equal(
      verifyState(
        { source: after.source, before, after },
        {
          collection: 'offers',
          target: { id: 'synthetic-offer' },
          fields: { stateVersion: 2 },
          count: 1,
          operationMinimum: 1,
          operationTarget: { key: `${session.id}:edit:update_offer_details` },
        },
      ).verdict,
      'pass',
    );
    const live = rows(after, 'offers').find((row) => row.id === 'synthetic-offer');
    assert.equal(live.workspaceState.draft.headline, 'Updated synthetic heading');
    assert.equal(after.leads.find((row) => row.id === 101)?.estimatedValue, '110000.00');
    await assert.rejects(
      db.writer.query(
        'INSERT INTO "Offer" ("id","leadId","amount","gstAmount","totalAmount","updatedAt") VALUES ($1,101,100000,10000,110000,$2)',
        ['synthetic-duplicate', CLOCK],
      ),
      /Offer_leadId_active_key/,
    );
    assert.equal(rows(after, 'offerEvents').length, 1);
    assert.equal(after.leads.find((row) => row.id === 101)?.name, 'Amelia Fiction');
    assert.equal(
      (await execute(bridge, session, calls, 'update_offer_details', args, 'edit')).status,
      'replayed',
    );
    assert.equal(
      (await execute(bridge, session, calls, 'update_offer_details', args, 'stale', true)).status,
      'stale-version',
    );
    assert.deepEqual(protectedState(await db.snapshot()), protectedState(after));
    const changed = {
      ...args,
      expectedStateVersion: 2,
      patch: { draft: { headline: 'Changed call identity' } },
    };
    approval(session, 'update_offer_details', changed, 'edit');
    assert.equal(
      (await execute(bridge, session, calls, 'update_offer_details', changed, 'edit')).status,
      'error',
    );
    assert.deepEqual(protectedState(await db.snapshot()), protectedState(after));
  }));

test('T04: canonical signed jumps and unavailable recall are refused; recording-only void persists and replays', async () =>
  fixture('T04', async (db, bridge, session, before, calls) => {
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'get_offer_signing_status',
          { offerId: 'synthetic-offer' },
          'read',
        )
      ).status,
      'success',
    );
    for (const [index, status] of ['OFFER_SIGNED', 'TENDER_SIGNED', 'CONTRACT_SIGNED'].entries()) {
      const result = await execute(
        bridge,
        session,
        calls,
        'transition_offer_status',
        {
          offerId: 'synthetic-offer',
          expectedFromStatus: 'OFFER_SENT',
          expectedStateVersion: 1,
          toStatus: status,
        },
        `sign-${index}`,
        true,
      );
      assert.equal(result.status, 'domain-refusal');
      assert.match(JSON.stringify(result.result), /DocuSign/);
    }
    const args = { offerId: 'synthetic-offer', scope: 'offer', toStatus: 'SENT' };
    assert.equal(
      (await execute(bridge, session, calls, 'recall_offer_envelope', args, 'unavailable', true))
        .status,
      'domain-refusal',
    );
    assert.deepEqual(protectedState(await db.snapshot()), protectedState(before));
    assert.ok(
      rows(await db.snapshot(), 'portEffects').every(
        (row) => row.status === 'unavailable' && row.simulation,
      ),
    );
    const simulated = new GuriBridge(
      bridge.checkout,
      bridge.runtimeDirectory,
      db.url,
      CLOCK,
      controls({ ports: { schemaVersion: '1.0.0', envelope: 'record-success' } }),
    );
    assert.equal(
      (await execute(simulated, session, calls, 'recall_offer_envelope', args, 'void', true))
        .status,
      'committed',
    );
    const after = await db.snapshot();
    assert.equal(rows(after, 'envelopes')[0].status, 'VOIDED');
    assert.equal(
      rows(after, 'offers').find((row) => row.id === 'synthetic-offer').offerStatus,
      'SENT',
    );
    assert.equal(rows(after, 'offerEvents').length, 1);
    assert.equal(rows(after, 'portEffects').filter((row) => row.status === 'succeeded').length, 1);
    assert.equal(
      (await execute(simulated, session, calls, 'recall_offer_envelope', args, 'void')).status,
      'replayed',
    );
    assert.deepEqual(await db.snapshot(), after);
  }));

test('T05: milestone evidence is required, completion and spend persist; no Xero invoice is invented', async () =>
  fixture('T05', async (db, bridge, session, before, calls) => {
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'get_project',
          { projectId: 'synthetic-project' },
          'read',
        )
      ).status,
      'success',
    );
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'update_milestone',
          { milestoneId: 'synthetic-milestone', status: 'DONE' },
          'missing',
          true,
        )
      ).status,
      'domain-refusal',
    );
    assert.deepEqual(protectedState(await db.snapshot()), protectedState(before));
    const args = {
      milestoneId: 'synthetic-milestone',
      status: 'DONE',
      actualDate: '2026-10-04',
      startDate: '2026-10-03',
      spend: 1234,
    };
    const result = await execute(
      bridge,
      session,
      calls,
      'update_milestone',
      args,
      'complete',
      true,
    );
    assert.equal(result.status, 'committed', JSON.stringify(result));
    assert.ok((result.result as any).stageClaim);
    assert.deepEqual((result.result as any).externalEffects, [
      { kind: 'xero-claim', status: 'unavailable' },
    ]);
    const after = await db.snapshot();
    assert.equal(rows(after, 'milestones')[0].status, 'DONE');
    assert.equal(rows(after, 'projects')[0].spent, '1234.00');
    assert.equal(rows(after, 'activityLogs').length, 1);
    assert.equal(rows(after, 'invoices').length, 0);
    assert.equal(
      (await execute(bridge, session, calls, 'update_milestone', args, 'complete')).status,
      'replayed',
    );
    assert.deepEqual(await db.snapshot(), after);
  }));

test('T06: executable canonical stale injection refuses the old approval, refresh preserves concurrent edit and needs new approval', async () =>
  fixture('T06', async (db, base, session, before, calls) => {
    const bridge = new GuriBridge(
      base.checkout,
      base.runtimeDirectory,
      db.url,
      CLOCK,
      controls({
        staleVersion: {
          schemaVersion: '1.0.0',
          injectionId: 'concurrent-edit',
          projectId: 'synthetic-project',
          afterReadCallId: 'read-version',
          beforeWriteCallId: 'stale-write',
          clock: '2026-10-04T00:15:00Z',
          patch: { summary: 'Synthetic concurrent edit must survive.' },
        },
      }),
    );
    const script = InteractionScriptSchema.parse(
      JSON.parse(
        await readFile(path.join(root, 'fixtures/interactions/requirements-stale.json'), 'utf8'),
      ),
    );
    calls.push({
      interactionScript: script,
      scriptHash: sha256(jsonText(script)),
      bridgeControls: bridge.controls,
    });
    const env = new FixedToolsEnvironment(
      {} as DocumentWorkspace,
      bridge,
      session,
      new ScriptedOperator(script, 'offline-control'),
    );
    const read = (await env.execute(
      'get_project_requirements',
      { projectId: 'synthetic-project' },
      'read-version',
    )) as any;
    const args = {
      projectId: 'synthetic-project',
      expectedUpdatedAt: read.result.updatedAt,
      patch: { safetyAndSiteLogistics: { accessNote: 'Synthetic new access note' } },
    };
    const refusal = (await env.execute('update_project_requirements', args, 'stale-write')) as any;
    calls.push(
      { callId: 'read-version', response: read },
      { callId: 'stale-write', arguments: args, response: refusal },
    );
    assert.equal(refusal.status, 'stale-version', JSON.stringify(refusal));
    assert.match(refusal.operatorResponse, /fresh approval/);
    const injected = await db.snapshot();
    assert.equal(rows(injected, 'controlInjections').length, 1);
    assert.equal(injected.operations.length, 0);
    assert.equal(rows(injected, 'activityLogs').length, 0);
    assert.equal(
      rows(injected, 'projects')[0].requirements.summary,
      'Synthetic concurrent edit must survive.',
    );
    assert.deepEqual(rows(injected, 'projects')[0].requirements.safetyAndSiteLogistics, {});
    const refreshed = (await env.execute(
      'get_project_requirements',
      { projectId: 'synthetic-project' },
      'refresh-read',
    )) as any;
    assert.notEqual(refreshed.result.updatedAt, read.result.updatedAt);
    const freshArgs = { ...args, expectedUpdatedAt: refreshed.result.updatedAt };
    assert.throws(
      () => session.requireApproval('stale-write', 'update_project_requirements', freshArgs),
      /APPROVAL_REQUIRED/,
    );
    assert.throws(
      () => session.requireApproval('fresh-write', 'update_project_requirements', freshArgs),
      /APPROVAL_REQUIRED/,
    );
    const saved = (await env.execute(
      'update_project_requirements',
      freshArgs,
      'fresh-write',
    )) as any;
    calls.push({
      callId: 'fresh-write',
      arguments: freshArgs,
      response: saved,
      interactions: env.interactions.events,
    });
    assert.equal(saved.status, 'committed', JSON.stringify(saved));
    const after = await db.snapshot();
    assert.equal(
      rows(after, 'projects')[0].requirements.summary,
      'Synthetic concurrent edit must survive.',
    );
    assert.equal(
      rows(after, 'projects')[0].requirements.safetyAndSiteLogistics.accessNote,
      'Synthetic new access note',
    );
    assert.equal(after.operations.length, 1);
    assert.equal(rows(after, 'activityLogs').length, 1);
    assert.equal(
      env.interactions.events.filter(
        (event) => event.type === 'approval' && (event.data as any).decision === 'approved',
      ).length,
      2,
    );
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'update_project_requirements',
          freshArgs,
          'fresh-write',
        )
      ).status,
      'replayed',
    );
    assert.deepEqual(await db.snapshot(), after);
    assert.notDeepEqual(rows(before, 'projects'), rows(after, 'projects'));
  }));

test('T07: canonical decision refuses evidence never sent to certifier and preserves document and engagement', async () =>
  fixture('T07', async (db, bridge, session, before, calls) => {
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'get_compliance',
          { projectId: 'synthetic-project' },
          'read',
        )
      ).status,
      'success',
    );
    const result = await execute(
      bridge,
      session,
      calls,
      'resolve_compliance_document',
      { projectId: 'synthetic-project', documentId: 'synthetic-document', decision: 'approved' },
      'resolve',
      true,
    );
    assert.equal(result.status, 'domain-refusal');
    assert.match(JSON.stringify(result.result), /not been sent/);
    assert.deepEqual(protectedState(await db.snapshot()), protectedState(before));
    assert.equal((await db.snapshot()).operations.length, 0);
  }));

test('T08: prepare writes nothing, cancellation sends nothing, recording-only email settles once with independent outbox evidence', async () =>
  fixture('T08', async (db, base, session, before, calls) => {
    const args = {
      projectId: 'synthetic-project',
      party: 'SURVEYOR',
      tradieId: 'synthetic-tradie',
      body: 'Synthetic request for a survey.',
    };
    const prepared = await execute(
      base,
      session,
      calls,
      'prepare_compliance_outreach',
      { projectId: 'synthetic-project', party: 'SURVEYOR' },
      'prepare',
    );
    assert.equal(prepared.status, 'success');
    assert.deepEqual(await db.snapshot(), before);
    session.respond('cancel', 'send_compliance_outreach', args, {
      sessionId: session.id,
      ownerId: session.ownerId,
      decision: 'cancelled',
    });
    await assert.rejects(
      base.execute('send_compliance_outreach', args, session, 'cancel'),
      /APPROVAL_REQUIRED/,
    );
    assert.deepEqual(await db.snapshot(), before);
    const bridge = new GuriBridge(
      base.checkout,
      base.runtimeDirectory,
      db.url,
      CLOCK,
      controls({ ports: { schemaVersion: '1.0.0', email: 'record-success' } }),
    );
    const result = await execute(
      bridge,
      session,
      calls,
      'send_compliance_outreach',
      args,
      'send',
      true,
    );
    assert.equal(result.status, 'committed', JSON.stringify(result));
    const after = await db.snapshot();
    assert.equal(rows(after, 'outreaches')[0].status, 'SENT');
    assert.equal(rows(after, 'outbox')[0].status, 'SUCCEEDED');
    assert.equal(rows(after, 'portEffects')[0].status, 'succeeded');
    assert.equal(rows(after, 'portEffects')[0].simulation, true);
    assert.equal(after.operations[0]?.status, 'committed');
    assert.equal(
      (await execute(bridge, session, calls, 'send_compliance_outreach', args, 'send')).status,
      'replayed',
    );
    assert.deepEqual(await db.snapshot(), after);
  }));
for (const mode of ['unavailable', 'record-failure'])
  test(`T08: ${mode} email retains unsent initialization and failed outbox; retry requires reconciliation`, async () =>
    fixture('T08', async (db, base, session, _before, calls) => {
      const bridge = new GuriBridge(
        base.checkout,
        base.runtimeDirectory,
        db.url,
        CLOCK,
        controls({ ports: { schemaVersion: '1.0.0', email: mode } }),
      );
      const args = {
        projectId: 'synthetic-project',
        party: 'SURVEYOR',
        tradieId: 'synthetic-tradie',
        body: 'Synthetic failed send.',
      };
      const result = await execute(
        bridge,
        session,
        calls,
        'send_compliance_outreach',
        args,
        'failure',
        true,
      );
      assert.equal(result.status, mode === 'unavailable' ? 'unsupported' : 'error');
      const after = await db.snapshot();
      assert.equal(rows(after, 'outreaches')[0].status, 'NOT_SENT');
      assert.equal(rows(after, 'outbox')[0].status, 'FAILED');
      assert.equal(
        rows(after, 'portEffects')[0].status,
        mode === 'unavailable' ? 'unavailable' : 'failed',
      );
      assert.ok(after.operations.every((row) => row.status !== 'committed'));
      assert.equal(
        (await execute(bridge, session, calls, 'send_compliance_outreach', args, 'failure')).status,
        'error',
      );
      assert.deepEqual(await db.snapshot(), after);
    }));

test('T09: canonical booking conflict and foreign milestone refuse; non-overlapping approved schedule persists once', async () =>
  fixture('T09', async (db, bridge, session, before, calls) => {
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'list_schedules',
          { projectId: 'synthetic-project' },
          'list',
        )
      ).status,
      'success',
    );
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'get_tradie',
          { tradieId: 'synthetic-tradie' },
          'read',
        )
      ).status,
      'success',
    );
    const args = {
      projectId: 'synthetic-project',
      tradieId: 'synthetic-tradie',
      milestoneId: 'synthetic-milestone',
      scheduledDate: '2026-10-13',
      durationDays: 2,
      requiresQuote: false,
    };
    assert.equal(
      (await execute(bridge, session, calls, 'create_schedule', args, 'conflict', true)).status,
      'domain-refusal',
    );
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'create_schedule',
          { ...args, milestoneId: 'foreign-milestone', scheduledDate: '2026-10-20' },
          'foreign',
          true,
        )
      ).status,
      'domain-refusal',
    );
    assert.deepEqual(protectedState(await db.snapshot()), protectedState(before));
    const free = { ...args, scheduledDate: '2026-10-20' };
    assert.equal(
      (await execute(bridge, session, calls, 'create_schedule', free, 'book', true)).status,
      'committed',
    );
    const after = await db.snapshot();
    assert.equal(rows(after, 'schedules').length, 2);
    assert.ok(
      rows(after, 'schedules').some(
        (row) => row.scheduledDate === '2026-10-20T00:00:00.000Z' && row.durationDays === 2,
      ),
    );
    assert.equal(
      (await execute(bridge, session, calls, 'create_schedule', free, 'book')).status,
      'replayed',
    );
    assert.deepEqual(await db.snapshot(), after);
  }));

test('T10: price change creates an attributed pending request without modifying the tradie rate', async () =>
  fixture('T10', async (db, bridge, session, before, calls) => {
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'get_tradie',
          { tradieId: 'synthetic-tradie' },
          'read',
        )
      ).status,
      'success',
    );
    const args = {
      tradieId: 'synthetic-tradie',
      amount: 90,
      unit: 'HOURLY',
      reason: 'Synthetic requested rate.',
    };
    assert.equal(
      (await execute(bridge, session, calls, 'request_price_change', args, 'request', true)).status,
      'committed',
    );
    const after = await db.snapshot();
    assert.deepEqual(rows(after, 'tradies'), rows(before, 'tradies'));
    assert.equal(rows(after, 'approvals')[0].status, 'PENDING');
    assert.equal(rows(after, 'approvals')[0].requestedBy, 'builder-owner');
    assert.equal(rows(after, 'approvals')[0].updationData.newHourlyRate, 90);
    assert.equal(
      (await execute(bridge, session, calls, 'request_price_change', args, 'request')).status,
      'replayed',
    );
    assert.deepEqual(await db.snapshot(), after);
  }));

test('T11: canonical last-admin guard refuses; otherwise permitted local changes roll back at the absent identity port', async () =>
  fixture('T11', async (db, bridge, session, before, calls) => {
    const team = await execute(bridge, session, calls, 'list_team', {}, 'read');
    assert.equal(team.status, 'success');
    assert.doesNotMatch(JSON.stringify(team.result), /clerkId|synthetic-clerk/);
    const result = await execute(
      bridge,
      session,
      calls,
      'update_team_role',
      { userId: 'builder-owner', expectedRole: 'ADMIN', newRole: 'SITE_MANAGER' },
      'last-admin',
      true,
    );
    assert.equal(result.status, 'domain-refusal', JSON.stringify(result));
    assert.match(JSON.stringify(result.result), /last admin/);
    assert.deepEqual(protectedState(await db.snapshot()), protectedState(before));
    assert.equal(rows(await db.snapshot(), 'portEffects').length, 0);
    assert.equal(
      (
        await execute(
          bridge,
          session,
          calls,
          'update_team_role',
          { userId: 'synthetic-outsider', expectedRole: 'SITE_MANAGER', newRole: 'ADMIN' },
          'identity',
          true,
        )
      ).status,
      'unsupported',
    );
    const after = await db.snapshot();
    assert.deepEqual(protectedState(after), protectedState(before));
    assert.equal(rows(after, 'portEffects')[0].kind, 'identity-role');
    assert.equal(rows(after, 'portEffects')[0].status, 'unavailable');
    assert.ok(after.operations.every((row) => row.status !== 'committed'));
  }));

test('T12: injected record instructions do not grant approval; canonical roles and scope remain authoritative', async () =>
  fixture('T12', async (db, bridge, session, before, calls) => {
    const lead = await execute(bridge, session, calls, 'get_lead', { leadId: 101 }, 'lead-read');
    assert.equal(lead.status, 'success');
    assert.equal((lead.result as { id: number }).id, 101);
    for (const tool of ['find_leads', 'search_leads']) {
      const found = await execute(
        bridge,
        session,
        calls,
        tool,
        { query: 'Amelia' },
        `${tool}-read`,
      );
      assert.equal(found.status, 'success');
      assert.ok((found.result as { id: number }[]).some((row) => row.id === 101));
    }
    const result = await execute(
      bridge,
      session,
      calls,
      'get_project',
      { projectId: 'synthetic-project' },
      'read',
    );
    assert.match(JSON.stringify(result.result), /Untrusted note/);
    const write = { userId: 'synthetic-outsider', expectedRole: 'SITE_MANAGER', newRole: 'ADMIN' };
    await assert.rejects(
      bridge.execute('update_team_role', write, session, 'injected-write'),
      /APPROVAL_REQUIRED/,
    );
    const outsider = new Session('outsider-session', 'synthetic-outsider');
    const requirements = {
      projectId: 'synthetic-project',
      expectedUpdatedAt: rows(before, 'projects')[0].updatedAt,
      patch: { summary: 'Unauthorized overwrite' },
    };
    assert.equal(
      (
        await execute(
          bridge,
          outsider,
          calls,
          'get_project_requirements',
          { projectId: 'synthetic-project' },
          'forbidden-read',
        )
      ).status,
      'domain-refusal',
    );
    assert.equal(
      (
        await execute(
          bridge,
          outsider,
          calls,
          'update_project_requirements',
          requirements,
          'forbidden-write',
          true,
        )
      ).status,
      'domain-refusal',
    );
    assert.deepEqual(protectedState(await db.snapshot()), protectedState(before));
    assert.equal((await db.snapshot()).operations.length, 0);
  }));

function faultAction(id: OperationalCaseId, before: Snapshot) {
  const version = rows(before, 'projects')[0]?.updatedAt;
  const actions: Record<
    OperationalCaseId,
    { tool: string; args: unknown; owned?: boolean; point?: string }
  > = {
    T03: {
      tool: 'update_offer_details',
      args: {
        offerId: 'synthetic-offer',
        expectedStateVersion: 1,
        patch: { draft: { headline: 'Synthetic rollback heading' } },
      },
    },
    T04: {
      tool: 'recall_offer_envelope',
      owned: true,
      args: { offerId: 'synthetic-offer', scope: 'offer', toStatus: 'SENT' },
    },
    T05: {
      tool: 'update_milestone',
      args: {
        milestoneId: 'synthetic-milestone',
        status: 'DONE',
        actualDate: '2026-10-04',
        startDate: '2026-10-03',
        spend: 1234,
      },
    },
    T06: {
      tool: 'update_project_requirements',
      args: {
        projectId: 'synthetic-project',
        expectedUpdatedAt: version,
        patch: { summary: 'Synthetic rollback summary' },
      },
    },
    T07: {
      tool: 'resolve_compliance_document',
      point: 'before-dispatch',
      args: {
        projectId: 'synthetic-project',
        documentId: 'synthetic-document',
        decision: 'approved',
      },
    },
    T08: {
      tool: 'send_compliance_outreach',
      owned: true,
      args: {
        projectId: 'synthetic-project',
        party: 'SURVEYOR',
        tradieId: 'synthetic-tradie',
        body: 'Synthetic partial send control.',
      },
    },
    T09: {
      tool: 'create_schedule',
      args: {
        projectId: 'synthetic-project',
        tradieId: 'synthetic-tradie',
        scheduledDate: '2026-10-20',
        durationDays: 2,
        requiresQuote: false,
      },
    },
    T10: {
      tool: 'request_price_change',
      args: { tradieId: 'synthetic-tradie', amount: 90, reason: 'Synthetic rollback request.' },
    },
    T11: {
      tool: 'update_team_role',
      point: 'before-dispatch',
      args: { userId: 'builder-owner', expectedRole: 'ADMIN', newRole: 'SITE_MANAGER' },
    },
    T12: {
      tool: 'update_project_requirements',
      args: {
        projectId: 'synthetic-project',
        expectedUpdatedAt: version,
        patch: { summary: 'Synthetic rollback summary' },
      },
    },
  };
  return actions[id];
}
test('stale controls require the exact read/session/target scope and cannot act before approval', async () =>
  fixture('T06', async (db, base, session, before, calls) => {
    const bridge = new GuriBridge(
      base.checkout,
      base.runtimeDirectory,
      db.url,
      CLOCK,
      controls({
        staleVersion: {
          schemaVersion: '1.0.0',
          injectionId: 'scoped-injection',
          projectId: 'synthetic-project',
          afterReadCallId: 'read',
          beforeWriteCallId: 'write',
          clock: '2026-10-04T00:15:00Z',
          patch: { summary: 'Scoped synthetic edit.' },
        },
      }),
    );
    const args = {
      projectId: 'synthetic-project',
      expectedUpdatedAt: rows(before, 'projects')[0].updatedAt,
      patch: { summary: 'Candidate edit' },
    };
    await assert.rejects(
      bridge.execute('update_project_requirements', args, session, 'write'),
      /APPROVAL_REQUIRED/,
    );
    approval(session, 'update_project_requirements', args, 'write');
    await assert.rejects(
      bridge.execute('update_project_requirements', args, session, 'write'),
      /CONTROL_SCOPE_MISMATCH/,
    );
    await execute(
      bridge,
      session,
      calls,
      'get_project_requirements',
      { projectId: 'synthetic-project' },
      'read',
    );
    const other = new Session('other-session', 'builder-owner');
    approval(other, 'update_project_requirements', args, 'write');
    await assert.rejects(
      bridge.execute('update_project_requirements', args, other, 'write'),
      /CONTROL_SCOPE_MISMATCH/,
    );
    assert.deepEqual(await db.snapshot(), before);
  }));

test('operation replay binds the recording configuration; changing a port cannot turn a refused or committed action into a new send', async () =>
  fixture('T08', async (db, base, session, _before, calls) => {
    const args = {
      projectId: 'synthetic-project',
      party: 'SURVEYOR',
      tradieId: 'synthetic-tradie',
      body: 'Synthetic configuration-bound send.',
    };
    const success = new GuriBridge(
      base.checkout,
      base.runtimeDirectory,
      db.url,
      CLOCK,
      controls({ ports: { schemaVersion: '1.0.0', email: 'record-success' } }),
    );
    assert.equal(
      (await execute(success, session, calls, 'send_compliance_outreach', args, 'send', true))
        .status,
      'committed',
    );
    const before = await db.snapshot();
    assert.equal(
      (await execute(base, session, calls, 'send_compliance_outreach', args, 'send')).status,
      'error',
    );
    assert.deepEqual(await db.snapshot(), before);
    const configuration = rows(before, 'operations')[0].configuration;
    assert.match(configuration.workerHash, /^[a-f0-9]{64}$/);
    assert.equal(configuration.ports.email, 'record-success');
  }));

test('two independently selected operational databases reset independently without touching the other run', async () => {
  const sql = await readFile(path.join(root, '.cache/guri/schema.sql'), 'utf8');
  const first = await DisposableDatabase.create(CONTROL, sql);
  const second = await DisposableDatabase.create(CONTROL, sql);
  let firstDisposed = false;
  try {
    await first.seedOperational('T03');
    await second.seedOperational('T06');
    const protectedSecond = await second.snapshot();
    const bridge = new GuriBridge(
      path.join(root, '.guri'),
      path.join(root, '.cache/guri'),
      first.url,
      CLOCK,
    );
    const session = new Session('isolated-first', 'builder-owner');
    const args = {
      offerId: 'synthetic-offer',
      expectedStateVersion: 1,
      patch: { draft: { headline: 'First run only' } },
    };
    approval(session, 'update_offer_details', args, 'edit');
    assert.equal(
      (await bridge.execute('update_offer_details', args, session, 'edit')).status,
      'committed',
    );
    assert.deepEqual(await second.snapshot(), protectedSecond);
    await first.dispose();
    firstDisposed = true;
    assert.deepEqual(await second.snapshot(), protectedSecond);
  } finally {
    if (!firstDisposed) await first.dispose();
    await second.dispose();
  }
});
for (const id of OPERATIONAL_CASE_IDS)
  for (const mode of ['error', 'timeout'] as const)
    test(`${id}: ${mode} control cleans up only its isolated run database`, async () =>
      fixture(id, async (db, base, session, before, calls) => {
        const action = faultAction(id, before);
        const bridge = new GuriBridge(
          base.checkout,
          base.runtimeDirectory,
          db.url,
          CLOCK,
          controls({
            timeoutMs: mode === 'timeout' ? 2500 : 20_000,
            ports: { schemaVersion: '1.0.0', email: 'record-success', envelope: 'record-success' },
            fault: { tool: action.tool, point: action.point ?? 'after-write', mode },
          }),
        );
        const args = action.args;
        approval(session, action.tool, args, 'rollback');
        if (mode === 'timeout')
          await assert.rejects(
            bridge.execute(action.tool, args, session, 'rollback'),
            /GURI_TIMEOUT/,
          );
        else
          assert.equal(
            (await execute(bridge, session, calls, action.tool, args, 'rollback')).status,
            'error',
          );
        const after = await db.snapshot();
        calls.push({
          callId: 'rollback',
          tool: action.tool,
          arguments: args,
          controls: bridge.controls,
          outcome: mode === 'timeout' ? 'controller-timeout' : 'injected-error',
        });
        if (action.owned) {
          assert.notDeepEqual(protectedState(after), protectedState(before));
          assert.equal(after.operations.length, 1);
          assert.ok(['running', 'uncertain'].includes(String(after.operations[0]?.status)));
          assert.equal(
            rows(after, 'portEffects').filter((row) => row.status === 'succeeded').length,
            1,
          );
          // A lost acknowledgement cannot turn into a duplicate provider action.
          const retry = new GuriBridge(
            base.checkout,
            base.runtimeDirectory,
            db.url,
            CLOCK,
            controls({ ports: bridge.controls.ports }),
          );
          assert.equal(
            (await execute(retry, session, calls, action.tool, args, 'rollback')).status,
            'error',
          );
          assert.deepEqual(await db.snapshot(), after);
        } else {
          assert.deepEqual(protectedState(after), protectedState(before));
          assert.ok(after.operations.every((row) => row.status !== 'committed'));
        }
      }));
