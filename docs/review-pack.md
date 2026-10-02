# Foundation business review pack

Status: **draft; no human approval recorded**. The target is NSW residential
construction for any builder. These are original fictional operating assumptions,
not a statement of current law. The sources, grading expectations and policy are
private. Inspect both splits as a reviewer; candidate models receive only the
allowed documents and policy.

Other NSW residential builder businesses are eligible reviewers; review is not
restricted to Royal Construction. Record the reviewing business or its designated
reviewer's name, the actual review decision and scope. Eligibility alone does
not approve the pack.

## Review the policy

Read [the original specimen policy](../fixtures/policies/nsw-builder-v1.md) and
[the new authored-case policy 1.1.0](../fixtures/policies/nsw-builder-v1.1.md).
Confirm or amend the quote base, additive markups, rounding, accepted-price
precedence, forecast probabilities, cost basis, cash/receivable distinction,
negotiation approval boundaries and evidence precedence. Product behavior is
reference evidence; intended business policy takes precedence.

Read [Cedar](../fixtures/worlds/cedar-world.json) and
[Estuary](../fixtures/worlds/estuary-world.json) for realism and coherent identities,
amounts and workflows. Cedar has individual owners, a duplex and ambiguous leads.
Estuary has a trust owner, two projects, recovery costs and an unpaid claim.
All names, contacts, addresses and commercial figures are fictional.

## Inspect the four specimen expectations

Amounts below are AUD. Their structured equivalents use integer cents.

| Definition   | Visible source                                                                     | Critical expectations                                                                           | Business explanation                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| D01 quote    | [Source](../tasks/offers/reconcile-quote-build-up/cedar/documents/source.json)     | Cost base $512,000; overhead $51,200; fee $40,960; total including supplied GST $664,576        | Explain additive markups on the same base and cite rows.                                                                     |
| D13 pipeline | [Source](../tasks/analytics/explain-pipeline-forecast/cedar/documents/source.json) | Known pipeline $1,000,000; weighted $880,000; one unknown value; won $600,000                   | Won overrides its stale 60% override; open uses supplied 70%; lost contributes zero. Pipeline is not revenue or cash.        |
| D14 margin   | [Source](../tasks/analytics/project-cost-margin/estuary/documents/source.json)     | Projected cost $520,000; projected profit -$83,200; pending variation excluded                  | $436,800 contract excluding GST versus spend plus remaining estimate. Disclose low confidence; no invented recovery savings. |
| D15 cash     | [Source](../tasks/analytics/summarize-cash-flow/estuary/documents/source.json)     | Closing cash $14,024; outstanding receivables $72,072; overdue true; payment verification false | Separate stated receipts from collection forecasts and invoices. Xero synchronization is unverified.                         |

Each pack also requires a cited `review.md` that explains the calculation, material
uncertainty and a grounded next action. Hidden expectations are in each task's
`grading/fixture.json`, `grading/rubric.json` and `grading/verification.json`; review those alongside its sources.
Verification plans declare scoped prose labels and expected facts. Review the
labels, required fields and supported numeric/date/claim forms; uncertain prose
stays unverified. Task versions are now 1.1.0 with frozen verification hashes;
the policy and underlying source numbers are unchanged. Canonical pricing oracle
generation passed on the pinned source, but generated expected values remain draft.
This foundation supplies authoring examples, not calibrated model results. D16
negotiation is defined in the catalogue and awaits its full case-authoring issue.

## Required review response

The [new case library](authored-cases.md) adds 24 core cases, seven document
variants and ten tool diagnostics. Review those source packs and their hidden
`grading/controls.json`, control artifacts, rubrics and verifiers alongside the
worlds and policies. Fixed-tools cases also need review of the parameterized
seed, recording/unavailable providers, fault controls and operator branches in
`grading/environment.json`. Reference controls are authored drafts, not
expert-approved correct outputs. Simulated errors and decisions are not real
specialist runs, human approvals or model calibration. Issues #12–#15 stay open
until their actual reviewed-pack acceptance requirements are satisfied.

Provide the reviewing builder business or designated reviewer's name, policy/world/case approvals or precise amendments,
and the scope reviewed. A real approval timestamp and versioned hashes will be
recorded after review. Offline validation and privacy scans have passed; they
cannot establish business correctness or replace this review. Execution preflight
continues to reject unapproved packs. Candidate execution is implemented and
requires a separate explicit paid-execution flag.

Configuration for later models, judges and environments is listed in
[configuration inputs](configuration.md). No credential is needed for this review.
