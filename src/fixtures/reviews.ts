// Recorded human reviews. Royal-Lab never invents a review: each record below
// transcribes a review reported by the repository owner, with its stated scope.
// An approval binds only to the exact case and fixture IDs listed with it, so
// anything authored later stays draft until a new review is recorded here.
export const OWNER_REVIEW_2026_10_04 = {
  status: 'approved' as const,
  reviewer: 'Gurpinder Uppal (business owner, Royal Construction Pty Ltd)',
  // Recording time: the reviewer's own review date was not stated.
  reviewedAt: '2026-10-04T03:28:59Z',
  notes:
    'Reported by the repository owner on 2026-10-04: all Royal-Lab fixtures were reviewed by the named business owner. Recorded scope: the 52 case packs (sources, candidate-visible policies 1.0.0/1.1.0/1.2.0, worlds, rubrics, verifier plans, reference and negative controls, seeded environments and operator scripts) plus the shared worlds, adversarial payloads and grader controls, with content as committed at 98f191a. Not covered: judge calibration labels, judge profiles, release-profile approval and the unit-test interaction controls.',
};
export const OWNER_REVIEWED_CASES: ReadonlySet<string> = new Set([
  'admin/protect-last-admin/estuary',
  'analytics/explain-pipeline-forecast/cedar',
  'analytics/explain-pipeline-forecast/estuary',
  'analytics/project-cost-margin/cedar',
  'analytics/project-cost-margin/estuary',
  'analytics/recommend-negotiation/estuary',
  'analytics/summarize-cash-flow/cedar',
  'analytics/summarize-cash-flow/estuary',
  'compliance/check-title-owners/cedar',
  'compliance/check-title-owners/cedar-unreadable',
  'compliance/classify-certifier-document/cedar',
  'compliance/extract-nested-checklist/estuary',
  'compliance/prepare-outreach-and-respect-cancel/cedar-client-plans-unapproved',
  'compliance/prepare-outreach-and-respect-cancel/cedar-da-route',
  'compliance/prepare-outreach-and-respect-cancel/cedar-stale-title-alert',
  'compliance/prepare-outreach-and-respect-cancel/estuary',
  'compliance/read-developer-verdict/estuary',
  'compliance/read-developer-verdict/estuary-injected',
  'compliance/refuse-unsent-document-approval/cedar',
  'compliance/unavailable-outreach-port/cedar',
  'finance/reconcile-stage-claim/estuary',
  'insurance/read-certificate-number/cedar',
  'insurance/read-certificate-number/cedar-number-not-printed',
  'leads/cancelled-follow-up/cedar',
  'leads/create-approved-follow-up/cedar',
  'leads/forged-out-of-band-approval/cedar',
  'leads/resolve-ambiguous-lead/cedar',
  'leads/unsupported-lead-email/cedar',
  'leads/wrong-responder-approval/cedar',
  'leads/wrong-session-approval/cedar',
  'offers/check-inclusion-consistency/cedar',
  'offers/explain-revision-price/cedar',
  'offers/reconcile-payment-schedule/estuary',
  'offers/reconcile-quote-build-up/cedar',
  'offers/reconcile-quote-build-up/estuary',
  'offers/reconcile-quote-build-up/estuary-injected',
  'offers/refresh-stale-offer/cedar',
  'offers/refuse-unsupported-signing-transition/estuary',
  'offers/update-current-revision/cedar',
  'projects/complete-milestone-with-evidence/cedar',
  'projects/extract-contract-particulars/cedar',
  'projects/handle-missing-owner-evidence/estuary',
  'projects/refresh-stale-requirements/estuary',
  'safety/ignore-disconnect-injection/cedar',
  'safety/ignore-record-injection/estuary',
  'safety/reader-specialist-error/cedar',
  'safety/reader-timeout/cedar',
  'safety/unsupported-offer-delivery/cedar',
  'safety/unsupported-variation/cedar',
  'tradies/ambiguous-booking-outcome/cedar',
  'tradies/avoid-schedule-conflict/cedar',
  'tradies/request-price-change/estuary',
]);
export const OWNER_REVIEWED_FIXTURES: ReadonlySet<string> = new Set([
  'world:development',
  'world:held-out',
  'adversarial:payloads',
  'grader-controls:index',
  'grader-controls:additive-markup',
  'grader-controls:nested-trace',
]);
export interface Draft {
  status: 'draft';
  reviewer: null;
  reviewedAt: null;
  notes: string;
}
export const caseReview = (taskId: string, draft: Draft) =>
  OWNER_REVIEWED_CASES.has(taskId) ? OWNER_REVIEW_2026_10_04 : draft;
export const fixtureReview = (fixtureId: string, draft: Draft) =>
  OWNER_REVIEWED_FIXTURES.has(fixtureId) ? OWNER_REVIEW_2026_10_04 : draft;
