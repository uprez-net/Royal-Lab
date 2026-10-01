import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DisposableDatabase } from '#src/environments/guri/database';
import { GuriBridge } from '#src/environments/guri/bridge';
import { Session } from '#src/environments/session';

test('canonical lead task commits row, history and call journal atomically; replay survives a new bridge instance', async () => {
  const root = process.cwd();
  const database = await DisposableDatabase.create(
    'postgresql://royal_lab:royal-lab-disposable-only@127.0.0.1:55432/royal_lab_control',
    await readFile(`${root}/.cache/guri/schema.sql`, 'utf8'),
  );
  try {
    await database.seed();
    const bridge = new GuriBridge(
      `${root}/.guri`,
      `${root}/.cache/guri`,
      database.url,
      '2026-10-04T00:30:00Z',
    );
    const session = new Session('integration-session', 'builder-owner');
    const leads = await bridge.execute('find_leads', { query: 'Amelia' }, session, 'lookup');
    assert.equal((leads.result as unknown[]).length, 2);
    const args = {
      leadId: 101,
      type: 'CALL',
      dueDate: '2026-10-05',
      dueTime: '10:00',
      notes: 'Confirm duplex scope.',
    };
    await assert.rejects(
      bridge.execute('create_lead_task', args, session, 'create-1'),
      /APPROVAL_REQUIRED/,
    );
    session.respond('create-1', 'create_lead_task', args, {
      sessionId: session.id,
      ownerId: session.ownerId,
      decision: 'approved',
    });
    const created = await bridge.execute('create_lead_task', args, session, 'create-1');
    assert.equal(created.status, 'committed', bridge.lastDiagnostic ?? 'no trusted diagnostic');
    const snapshot = await database.snapshot();
    assert.equal(snapshot.tasks.length, 1);
    assert.ok(snapshot.history.length >= 1);
    assert.equal(snapshot.operations.length, 1);
    assert.equal(snapshot.tasks[0]?.leadId, 101);
    const replay = await new GuriBridge(
      bridge.checkout,
      bridge.runtimeDirectory,
      database.url,
      bridge.clock,
    ).execute('create_lead_task', args, session, 'create-1');
    assert.equal(replay.status, 'replayed');
    assert.equal((await database.snapshot()).tasks.length, 1);
    await assert.rejects(
      bridge.execute('create_lead_task', { ...args, leadId: 102 }, session, 'create-1'),
      /APPROVAL_REQUIRED/,
    );
    session.respond('create-2', 'create_lead_task', args, {
      sessionId: session.id,
      ownerId: session.ownerId,
      decision: 'approved',
    });
    assert.equal(
      (await bridge.execute('create_lead_task', args, session, 'create-2')).status,
      'committed',
    );
    assert.equal((await database.snapshot()).tasks.length, 2);
    await assert.rejects(
      bridge.execute('raise_xero_invoice', {}, session, 'unsupported'),
      /UNSUPPORTED/,
    );
  } finally {
    await database.dispose();
  }
});
