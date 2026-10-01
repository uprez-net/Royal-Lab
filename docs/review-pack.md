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

Read [the frozen candidate policy](../fixtures/policies/nsw-builder-v1.md).
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
`grading/fixture.json` and `grading/rubric.json`; review those alongside its sources.
This foundation supplies authoring examples, not calibrated model results. D16
negotiation is defined in the catalogue and awaits its full case-authoring issue.

## Required review response

Provide the reviewing builder business or designated reviewer's name, policy/world/case approvals or precise amendments,
and the scope reviewed. A real approval timestamp and versioned hashes will be
recorded after review. Offline validation and privacy scans have passed; they
cannot establish business correctness or replace this review. Execution preflight
continues to reject unapproved packs, and candidate execution is a later issue.

Configuration for later models, judges and environments is listed in
[configuration inputs](configuration.md). No credential is needed for this review.
