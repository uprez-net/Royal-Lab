import { RecordingPortPolicySchema, type RecordingPortPolicy } from '#contracts/operational';
import { sha256 } from '#src/io';
import { stableJson } from '#src/environments/session';

interface PortDatabase {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<any>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
}
export class PortUnavailableError extends Error {
  constructor(readonly kind: string) {
    super(`PORT_UNAVAILABLE: ${kind}; no real provider is configured`);
  }
}
// These are synthetic receipts, never provider acknowledgements. No network client exists.
export class DurableRecordingProvider {
  readonly policy: RecordingPortPolicy;
  constructor(
    private db: PortDatabase,
    readonly operationKey: string,
    policy: unknown,
  ) {
    this.policy = RecordingPortPolicySchema.parse(policy);
  }
  async invoke(
    kind: 'email' | 'envelope-void' | 'envelope-status' | 'identity-role' | 'xero-claim',
    payload: unknown,
  ) {
    const hash = sha256(stableJson(payload));
    const target =
      payload && typeof payload === 'object' && 'id' in payload ? String(payload.id) : '';
    const key = `${this.operationKey}:${kind}:${target}`;
    const mode =
      kind === 'email'
        ? this.policy.email
        : kind.startsWith('envelope-')
          ? this.policy.envelope
          : 'unavailable';
    const status =
      mode === 'record-success'
        ? 'succeeded'
        : mode === 'record-failure'
          ? 'failed'
          : 'unavailable';
    await this.db.$executeRawUnsafe(
      'INSERT INTO "RoyalLabPortEffect" ("key","operationKey","kind","payloadHash","status","simulation") VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT ("key") DO NOTHING',
      key,
      this.operationKey,
      kind,
      hash,
      status,
    );
    const rows = await this.db.$queryRawUnsafe(
      'SELECT * FROM "RoyalLabPortEffect" WHERE "key"=$1',
      key,
    );
    if (rows[0]?.payloadHash !== hash) throw new Error('PORT_BINDING_CONFLICT');
    if (rows[0]?.status !== status) throw new Error('PORT_CONFIGURATION_CONFLICT');
    if (status === 'unavailable') throw new PortUnavailableError(kind);
    if (status === 'failed') throw new Error(`PORT_RECORDED_FAILURE: ${kind}`);
    return { simulation: true as const, status: 'succeeded' as const };
  }
  envelope = {
    void: async (id: string, reason: string) => {
      await this.invoke('envelope-void', { id, reason });
    },
    getStatus: async (id: string) => {
      await this.invoke('envelope-status', { id });
      return 'voided';
    },
  };
}
