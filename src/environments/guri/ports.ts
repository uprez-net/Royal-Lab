export interface RecordedEffect {
  id: string;
  callId: string;
  kind: string;
  status: 'succeeded' | 'failed' | 'cancelled' | 'replayed';
  payloadHash: string;
}
export class RecordingPorts {
  readonly effects: RecordedEffect[] = [];
  private responses = new Map<string, RecordedEffect>();
  record(
    effect: Omit<RecordedEffect, 'status'>,
    outcome: 'succeeded' | 'failed' | 'cancelled' = 'succeeded',
  ) {
    const key = `${effect.callId}:${effect.kind}`;
    const previous = this.responses.get(key);
    if (previous) {
      if (previous.payloadHash !== effect.payloadHash) throw new Error('PORT_BINDING_CONFLICT');
      return { ...previous, status: 'replayed' as const };
    }
    const recorded = { ...effect, status: outcome };
    this.effects.push(recorded);
    this.responses.set(key, recorded);
    return recorded;
  }
  unsupported(kind: string): never {
    throw new Error(`PORT_UNSUPPORTED: ${kind}; real providers are never configured`);
  }
}
