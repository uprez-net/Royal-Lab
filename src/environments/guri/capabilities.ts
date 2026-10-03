import { GURI_EFFECTS, GURI_TOOL_VERSIONS, type GuriTool } from '#src/environments/guri/tools';
// Execution capability, independent of case authoring/review and Eve availability.
export const GURI_CAPABILITIES = {
  bridgeVersion: '2.1.0',
  caseCoverage: ['T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12'],
  tools: Object.entries(GURI_EFFECTS).map(([name, effect]) => ({
    name,
    version: GURI_TOOL_VERSIONS[name as GuriTool],
    effect,
    boundary:
      (
        {
          update_offer_details:
            'Canonical draft headline/intro/terms patch only; other workspace sections unsupported.',
          transition_offer_status:
            'Canonical lifecycle guards; manual signed jumps disabled in the worker.',
          recall_offer_envelope:
            'Canonical recall; real provider absent. Recording simulation is offline-control only.',
          update_milestone:
            'Canonical milestone/roll-up/spend; due Xero claim is explicit unavailable work, never an invoice.',
          prepare_compliance_outreach:
            'SURVEYOR draft preparation only; canonical read, no send or initialization.',
          send_compliance_outreach:
            'SURVEYOR opening email only; canonical outbox, real provider absent; no extra attachments.',
          update_team_role:
            'Canonical last-admin/version guard; otherwise local change rolls back at unavailable identity port.',
        } as Partial<Record<GuriTool, string>>
      )[name as GuriTool] ?? 'Canonical command/access checks on the isolated selected fixture.',
  })),
  unsupported: [
    'offer/tender/contract send',
    'real email',
    'real DocuSign',
    'Xero invoice/contact/sync',
    'Blob upload/delete',
    'identity synchronization/invitation',
    'model-assisted extraction',
    'unlisted product tools',
  ],
  releaseReview: 'pending',
} as const;
