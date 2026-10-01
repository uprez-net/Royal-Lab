# Source audit and benchmark implications

Inspected 2026-10-01. This is source inspection, not a production-data audit, security
review, execution of product tests or measured model baseline. Full historical
findings and roadmap are preserved in [the parent snapshot](references/parent-audit-2026-10-01.md).
The current [measurement spec](benchmark-spec.md) supersedes its scope/oracle proposals.

## Versions and coverage

Royal-Construction reference: `460895235f94e917bd855855cd6e106f93a4c7c1`.
The remote main revision seen during intake was `e50353dedeea22b65957e936b142de0217914b07`;
the benchmark deliberately pins the audited revision rather than moving with main.
Harvey reference: `f93ae2ac2831e65892fea83094cfb50149bc2e59`.
All 57 specialist tool files were read at the pinned product revision, together
with the five operation adapters, domain guide, eval catalogue/runbook, source
helpers and extraction/workflow prompts. The [tool matrix](tool-capability-matrix.csv)
records each file's Git blob hash, adapter wrapper, discovered domain command/test,
approval declaration, durable/effect class and availability limitations. Call-chain
mapping is source evidence; four adapter-owned helper paths are explicitly marked
for bridge inspection rather than assigned a fictional canonical command.

The [28-case matrix](capability-matrix.csv) distinguishes document analysis from
current Eve support. All runtimeVerified fields are false. Planned fixtures and
unimplemented bridges are not described as shipped capabilities.

## Business lifecycle and critical examples

| Area                       | Inspected evidence                                                                                                    | Consequence for the benchmark                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Leads and pipeline         | `lib/domain/leads/{queries,tasks}.ts`, `lib/leads/pipeline-math.ts`, `lib/dates/sydney.ts`                            | Exact party resolution, unknown values, won/lost probabilities and frozen Sydney deadlines                      |
| Offers/pricing/negotiation | `lib/offer/workspace-pricing.ts`, `offer-contract-value.ts`, `lib/domain/offers/{workspace-save,status,revisions}.ts` | Additive rounded markups, accepted price authority, stale revisions, drafted rather than unapproved concessions |
| Contract-to-project        | `lib/agent/tender-extraction-prompts.ts`, `lib/domain/projects/owners.ts`                                             | Preserve owner block and precedence; no builder/witness/footer substitution                                     |
| Compliance/outreach        | `lib/domain/compliance/{documents,prerequisites,outreach,title-search-owners}.ts`, extraction prompts                 | Sent-evidence approval prerequisite, nested requirements, conditional verdicts, unreadable identifiers          |
| Activities/trades          | `lib/domain/projects/{milestones,requirements}.ts`, `lib/domain/tradies/{schedules,directory}.ts`                     | Required completion facts, versions, active overlaps, request-only price changes                                |
| Claims/cash flow           | `lib/domain/invoices/{stage-claim,sync}.ts`, `lib/projects/milestone-ledger.ts`, `lib/xero/invoice-status.ts`         | Root-stage grouping, waived/nonduplicated claims; issued/synced/paid are distinct                               |
| Identity/approvals         | `lib/domain/identity/team.ts`, `agent/lib/{agent-approval,audited-operation,channel-auth}.ts`                         | Last-admin guard, owner binding, exact persistence/audit/effect evidence                                        |

Verified source behaviors (references are evidence, not final business-policy authority):

- Overhead and fee apply to the same base and are each rounded before summing.
  $500,000 direct cost with no additions, 10% overhead, 10% fee and 10% GST gives
  $660,000; compounding would incorrectly give $665,500.
  [Pricing source](https://github.com/uprez-net/Royal-Construction/blob/460895235f94e917bd855855cd6e106f93a4c7c1/lib/offer/workspace-pricing.ts).
- Positive stored contract value is authoritative; missing/zero legacy values may
  derive from the revision's own workspace, and unpriced stays unknown.
  [Price authority](https://github.com/uprez-net/Royal-Construction/blob/460895235f94e917bd855855cd6e106f93a4c7c1/lib/offer/offer-contract-value.ts).
- Title-owner comparison accepts any recorded-owner overlap, not identical complete
  owner lists. No readable document owners or recorded owners is indeterminate.
  This is not permission to discard explicitly extracted owners. Final intended
  policy must be reviewed separately from this documented behavior.
  [Comparison](https://github.com/uprez-net/Royal-Construction/blob/460895235f94e917bd855855cd6e106f93a4c7c1/lib/domain/compliance/title-search-owners.ts).
- A settled entirely waived stage earns no claim; activity grouping follows its
  root, and an existing invoice prevents a duplicate. Eve may report a due stage
  claim but cannot raise the corresponding Xero invoice.
  [Claim command](https://github.com/uprez-net/Royal-Construction/blob/460895235f94e917bd855855cd6e106f93a4c7c1/lib/domain/invoices/stage-claim.ts).
- Audited replay keys are `agent:sessionId:callId:action`, not permanent intent
  deduplication. A new intentional follow-up is a new instruction.
  [Audit/replay](https://github.com/uprez-net/Royal-Construction/blob/460895235f94e917bd855855cd6e106f93a4c7c1/agent/lib/audited-operation.ts).
- Compliance preparation may initialize records. `check_offer_lists` and
  `draft_offer_highlights` use inclusion AI, so a model-only comparison must control
  that hidden provider call instead of counting it as deterministic tool support.
- The compliance specialist has no tools; compliance calls route to project operations.
  DocuSign control has an unavailable Eve port despite declared tool names. Lead
  email/meetings/stage/files, offer delivery, project handoff and variations are
  documented capability limits.
  [Existing eval limits](https://github.com/uprez-net/Royal-Construction/blob/460895235f94e917bd855855cd6e106f93a4c7c1/evals/README.md).

Current evals offer useful recursive child-session observation and approval tests,
but skip missing labels, leave durable audit verification to a maintenance command,
and cancel external actions. They do not establish end-to-end business reliability.
Royal-Lab preflights fixed manifests and requires independent effect verification.
Changing a judge model does not change the deployed candidate model.

## Benchmark references and decisions

Harvey's reference separates run/evaluate/report, closed synthetic document packs,
briefs, deliverables and scoped atomic rubrics. Its implementation uses semantic
judging and all-pass task scores; the dual-judge average and strict agreement are
distinct. We retain task design and add exact amount/date/state/effect checks.
The recursive Harvey tree was truncated; launch/docs task counts differ. No verified
current task census or replication of its unpublished authoring pipeline is claimed.
[Architecture](https://github.com/harveyai/harvey-labs/blob/f93ae2ac2831e65892fea83094cfb50149bc2e59/docs/architecture.md),
[methodology](https://github.com/harveyai/harvey-labs/blob/f93ae2ac2831e65892fea83094cfb50149bc2e59/docs/eval-strategies.md).

The requested DataForce article supports representative task inputs and expert
review for domain expectations. The Confident AI article motivates task/metric
separation and private domain evaluation; library recommendations were checked
against current primary docs rather than treating the article as a framework mandate.
[DataForce](https://www.dataforce.ai/blog/how-build-custom-llm-benchmark-accurate-evaluation),
[Confident AI](https://www.confident-ai.com/blog/the-current-state-of-benchmarking-llms).

The user approved D13–D16 for forecasting, cost/margin, cash flow and negotiation.
Intended NSW builder policies override product behavior across all profiles; code,
dataset and results stay private initially. Reviewer identity and pack-level business
approval are still required before candidate execution. No approval is fabricated.

Skills inspected/installed for authoring support: `wshobson/agents@llm-evaluation`
at `156b7a5e7a8b93642628a339ee4039c925b34c7f` and official `vercel/ai@ai-sdk` at
`eee1954ddd8ccf5e6c9a8582a826fba8b256653b`. They are developer guidance, not
model-visible task material or benchmark dependencies. Their generic examples do
not override our business-specific exact checks, versions or repeat methodology.
