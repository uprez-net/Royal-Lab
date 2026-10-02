import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  GURI_TOOL_SCHEMAS,
  GURI_EFFECTS,
  GURI_TOOL_VERSIONS,
  guriTool,
  parseGuriArguments,
} from '#src/environments/guri/tools';
import { GuriBridge } from '#src/environments/guri/bridge';
import {
  BridgeControlsSchema,
  RecordingPortPolicySchema,
  StaleVersionControlSchema,
} from '#contracts/operational';
import { DurableRecordingProvider } from '#src/environments/guri/recording-provider';
import { Session } from '#src/environments/session';
import { Interactions } from '#src/harness/interactions';
import { ScriptedOperator, InteractionScriptSchema } from '#src/harness/operator';
import { FIXED_TOOL_SCHEMAS } from '#src/environments/fixed-tools';
import { GURI_CAPABILITIES } from '#src/environments/guri/capabilities';
import { fixtureControlUrl } from '#src/environments/guri/database';

test('fixed-tools profile and capability declarations pin the expanded surface without migrating saved versions', async () => {
  const profile = JSON.parse(await readFile('profiles/fixed-tools.json', 'utf8'));
  assert.equal(profile.version, '2.0.0');
  assert.deepEqual(
    profile.tools.map((tool: { name: string }) => tool.name).sort(),
    Object.keys(FIXED_TOOL_SCHEMAS).sort(),
  );
  for (const tool of profile.tools) {
    assert.equal(
      tool.version,
      GURI_TOOL_VERSIONS[tool.name as keyof typeof GURI_TOOL_VERSIONS] ?? '1.0.0',
    );
  }
  assert.equal(GURI_CAPABILITIES.bridgeVersion, '2.0.0');
  assert.equal(GURI_CAPABILITIES.releaseReview, 'pending');
  assert.deepEqual(
    GURI_CAPABILITIES.tools.map((tool) => tool.name).sort(),
    Object.keys(GURI_TOOL_SCHEMAS).sort(),
  );
  assert.equal(GURI_TOOL_VERSIONS.find_leads, '2.0.0');
  assert.equal(GURI_TOOL_VERSIONS.create_lead_task, '1.0.0');
});

test('minimum operational tools declare read/write boundaries; privileged arguments and undeclared providers are rejected', () => {
  assert.deepEqual(Object.keys(GURI_EFFECTS).sort(), Object.keys(GURI_TOOL_SCHEMAS).sort());
  for (const name of [
    'raise_xero_invoice',
    'send_offer',
    'upload_blob',
    'inject_stale_version',
    'invite_team',
  ])
    assert.throws(() => guriTool(name), /GURI_UNSUPPORTED/);
  assert.throws(() =>
    parseGuriArguments('transition_offer_status', {
      offerId: 'o',
      toStatus: 'CONTRACT_SIGNED',
      expectedFromStatus: 'PENDING',
      expectedStateVersion: 1,
      skipTransitionCheck: true,
      allowManualSignedJump: true,
    }),
  );
  assert.throws(() =>
    parseGuriArguments('send_compliance_outreach', {
      projectId: 'p',
      party: 'SURVEYOR',
      tradieId: 't',
      body: 'Synthetic message',
      ports: { email: 'record-success' },
    }),
  );
  assert.throws(() =>
    parseGuriArguments('update_offer_details', {
      offerId: 'o',
      expectedStateVersion: 1,
      patch: { pricingSettings: {} },
    }),
  );
  assert.throws(
    () =>
      parseGuriArguments(
        'update_project_requirements',
        JSON.parse(
          '{"projectId":"p","expectedUpdatedAt":"2026-10-04T00:00:00Z","patch":{"__proto__":{"polluted":true}}}',
        ),
      ),
    /GURI_UNSAFE_KEY/,
  );
  assert.throws(
    () =>
      parseGuriArguments('update_project_requirements', {
        projectId: 'p',
        expectedUpdatedAt: '2026-10-04T00:00:00Z',
        patch: { summary: 'x'.repeat(21_000) },
      }),
    /GURI_ARGUMENT_LIMIT/,
  );
});

test('recording simulation and fault injection require the explicit offline-control mode; credentials are not accepted', () => {
  // Missing URL credentials must not fall back to ambient PostgreSQL settings.
  assert.throws(
    () => fixtureControlUrl('postgresql://127.0.0.1:55432/royal_lab_control'),
    /DATABASE_DENIED/,
  );
  assert.throws(
    () => fixtureControlUrl('postgresql://synthetic@127.0.0.1:55432/royal_lab_control'),
    /DATABASE_DENIED/,
  );
  const defaults = BridgeControlsSchema.parse({ schemaVersion: '1.0.0' });
  assert.equal(defaults.ports.email, 'unavailable');
  assert.equal(defaults.ports.envelope, 'unavailable');
  assert.throws(
    () =>
      new GuriBridge('.', '.', 'unused', '2026-10-04T00:00:00Z', {
        schemaVersion: '1.0.0',
        ports: { schemaVersion: '1.0.0', email: 'record-success' },
      }),
    /GURI_CONTROL_MODE_REQUIRED/,
  );
  assert.equal(
    RecordingPortPolicySchema.safeParse({
      schemaVersion: '1.0.0',
      email: 'live',
      apiKey: 'not-a-credential',
    }).success,
    false,
  );
  assert.equal(
    StaleVersionControlSchema.safeParse({
      schemaVersion: '1.0.0',
      injectionId: 'i',
      projectId: 'p',
      afterReadCallId: 'read',
      beforeWriteCallId: 'write',
      clock: '2026-10-04T00:00:00Z',
      patch: { summary: 'Synthetic concurrent edit', newRole: 'ADMIN' },
    }).success,
    false,
  );
});

function recordedDb() {
  const records = new Map<string, any>();
  return {
    records,
    db: {
      async $executeRawUnsafe(
        _query: string,
        key: unknown,
        operationKey: unknown,
        kind: unknown,
        payloadHash: unknown,
        status: unknown,
      ) {
        if (!records.has(String(key)))
          records.set(String(key), {
            key,
            operationKey,
            kind,
            payloadHash,
            status,
            simulation: true,
          });
      },
      async $queryRawUnsafe(_query: string, key: unknown) {
        return [records.get(String(key))];
      },
    },
  };
}
test('durable recording receipts retain unavailable and failed outcomes; success and replay are explicitly synthetic', async () => {
  const { db, records } = recordedDb();
  const absent = new DurableRecordingProvider(db, 'operation', { schemaVersion: '1.0.0' });
  await assert.rejects(absent.invoke('email', { body: 'Synthetic' }), /PORT_UNAVAILABLE/);
  await assert.rejects(
    absent.invoke('identity-role', { userId: 'u', role: 'ADMIN' }),
    /PORT_UNAVAILABLE/,
  );
  const failure = new DurableRecordingProvider(db, 'failure', {
    schemaVersion: '1.0.0',
    email: 'record-failure',
  });
  await assert.rejects(failure.invoke('email', { body: 'Synthetic' }), /RECORDED_FAILURE/);
  const success = new DurableRecordingProvider(db, 'success', {
    schemaVersion: '1.0.0',
    email: 'record-success',
  });
  assert.deepEqual(await success.invoke('email', { body: 'Synthetic' }), {
    simulation: true,
    status: 'succeeded',
  });
  await success.invoke('email', { body: 'Synthetic' });
  await assert.rejects(success.invoke('email', { body: 'Changed payload' }), /BINDING_CONFLICT/);
  assert.equal(records.size, 4);
  assert.ok([...records.values()].every((row) => row.simulation && !Object.hasOwn(row, 'body')));
  await assert.rejects(
    new DurableRecordingProvider(db, 'success', { schemaVersion: '1.0.0' }).invoke('email', {
      body: 'Synthetic',
    }),
    /CONFIGURATION_CONFLICT/,
  );
});

test('stale-version guidance never authorizes refreshed arguments and draft scripts remain blocked', () => {
  const script = InteractionScriptSchema.parse({
    schemaVersion: '1.0.0',
    version: '1.0.0',
    review: { status: 'draft', reviewer: null, reviewedAt: null, notes: 'Offline only.' },
    maxUnexpectedQuestions: 0,
    branches: [
      {
        id: 'refresh',
        type: 'stale-version',
        allWords: ['stale'],
        anyWords: [],
        response: 'Refresh and request a new approval.',
        responderId: 'builder-owner',
        decision: 'approved',
        maxUses: 1,
      },
    ],
  });
  assert.throws(() => new ScriptedOperator(script), /REVIEW_PENDING/);
  const session = new Session('s', 'builder-owner');
  const interactions = new Interactions(session, new ScriptedOperator(script, 'offline-control'));
  assert.equal(
    interactions.staleVersion('stale requirements', 'old-call').response,
    'Refresh and request a new approval.',
  );
  assert.throws(
    () =>
      session.requireApproval('old-call', 'update_project_requirements', {
        expectedUpdatedAt: 'new',
      }),
    /APPROVAL_REQUIRED/,
  );
  assert.equal(interactions.events.filter((event) => event.type === 'approval').length, 0);
});
