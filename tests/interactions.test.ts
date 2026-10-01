import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Session } from '#src/environments/session';
import { OperationJournal } from '#src/environments/operation-journal';
import { ScriptedOperator, InteractionScriptSchema } from '#src/harness/operator';
import { Interactions } from '#src/harness/interactions';
import { readJson } from '#src/io';
import { RecordingPorts } from '#src/environments/guri/ports';

test('focused clarification releases only the scripted fact; draft script is never execution-ready', async () => {
  const script = InteractionScriptSchema.parse(
    await readJson('fixtures/interactions/lead-follow-up.json'),
  );
  assert.throws(() => new ScriptedOperator(script), /REVIEW_PENDING/);
  const operator = new ScriptedOperator(script, 'offline-control');
  assert.throws(() => operator.answer('give me the golden result', 'clarification'), /UNMATCHED/);
  assert.equal(
    operator.answer('Can you clarify which Amelia?', 'clarification').branchId,
    'which-amelia',
  );
  assert.throws(() => operator.answer('Which Amelia?', 'clarification'), /EXHAUSTED/);
});
test('approval binds owner, session, target, arguments and call identity; narrative approval grants nothing', async () => {
  const session = new Session('session-one', 'builder-owner');
  const args = { leadId: 101, type: 'CALL' };
  assert.throws(() => session.requireApproval('call-one', 'create_lead_task', args), /REQUIRED/);
  for (const responder of [
    { sessionId: 'different', ownerId: 'builder-owner' },
    { sessionId: session.id, ownerId: 'wrong-owner' },
  ])
    assert.throws(
      () =>
        session.respond('call-one', 'create_lead_task', args, {
          ...responder,
          decision: 'approved',
        }),
      /WRONG_RESPONDER/,
    );
  session.respond('call-one', 'create_lead_task', args, {
    sessionId: session.id,
    ownerId: session.ownerId,
    decision: 'approved',
  });
  session.requireApproval('call-one', 'create_lead_task', args);
  assert.throws(
    () => session.requireApproval('call-one', 'create_lead_task', { ...args, leadId: 102 }),
    /REQUIRED/,
  );
  assert.throws(() => session.requireApproval('call-two', 'create_lead_task', args), /REQUIRED/);
  session.respond('call-one', 'create_lead_task', args, {
    sessionId: session.id,
    ownerId: session.ownerId,
    decision: 'cancelled',
  });
  assert.throws(() => session.requireApproval('call-one', 'create_lead_task', args), /REQUIRED/);
});
test('durable experiment journal replays across restart and blocks uncertain external acknowledgements', async () => {
  const directory = await mkdtemp(path.join(process.cwd(), 'tmp/journal-'));
  let journal = new OperationJournal(path.join(directory, 'operations.sqlite'));
  let writes = 0;
  try {
    await journal.execute('session:call:action', 'binding', async () => ({ writes: ++writes }));
    journal.close();
    journal = new OperationJournal(path.join(directory, 'operations.sqlite'));
    assert.equal(
      (await journal.execute('session:call:action', 'binding', async () => ({ writes: ++writes })))
        .status,
      'replayed',
    );
    assert.equal(writes, 1);
    await assert.rejects(
      journal.execute('session:call:action', 'changed', async () => null),
      /CONFLICT/,
    );
    await assert.rejects(
      journal.execute('uncertain', 'binding', async () => {
        throw new Error('lost acknowledgement');
      }),
    );
    await assert.rejects(
      journal.execute('uncertain', 'binding', async () => ++writes),
      /UNCERTAIN/,
    );
    assert.equal(writes, 1);
    await journal.execute('new-intention', 'binding', async () => ({ writes: ++writes }));
    assert.equal(writes, 2);
  } finally {
    journal.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('recording ports never contact real providers and preserve cancellation/fault/replay counts', () => {
  const ports = new RecordingPorts();
  const effect = { id: 'effect', callId: 'call', kind: 'email', payloadHash: 'frozen' };
  ports.record(effect, 'cancelled');
  assert.equal(ports.record(effect).status, 'replayed');
  assert.equal(ports.effects.filter((row) => row.status === 'succeeded').length, 0);
  assert.throws(() => ports.record({ ...effect, payloadHash: 'changed' }), /CONFLICT/);
  assert.throws(() => ports.unsupported('xero-raise'), /UNSUPPORTED/);
});
