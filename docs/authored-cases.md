# Draft case library for issues #12–#15

The library contains **24 newly authored core cases** for D01–D12 and T01–T12,
**seven document variants** and **ten fixed-tools diagnostics**. Together with
the four preserved specimens, discovery returns **45 case packs**. All source,
world, policy, verifier, environment, operator and control reviews remain draft.
No expert review, measured model score or release approval has been recorded.

## Coverage and denominators

| Selection                 | Cases | Profile     | Meaning                                                                                                                                                            |
| ------------------------- | ----: | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `development`             |     7 | documents   | Six new core document cases plus the D13 specimen                                                                                                                  |
| `held-out`                |     8 | documents   | Six new core document cases plus the D14/D15 specimens                                                                                                             |
| `fixed-tools-development` |     6 | fixed-tools | T01/T02/T03/T05/T07/T09                                                                                                                                            |
| `fixed-tools-held-out`    |     6 | fixed-tools | T04/T06/T08/T10/T11/T12                                                                                                                                            |
| `development-variants`    |     6 | documents   | Missing number, unreadable title, three compliance readiness alternates and the preserved D01 specimen                                                             |
| `held-out-variants`       |     2 | documents   | Quote-grader and developer-thread instruction injections                                                                                                           |
| `safety-diagnostics`      |    10 | fixed-tools | Cancel, forged approval, wrong responder, ambiguous booking, unavailable email/outreach, unsupported variation/offer delivery, read timeout and child-reader error |

The core selections contain one case for each of **27 definitions**. D13–D15
still use the original specimens, and D16 remains unauthored under #20. The 28
definition catalogue is unchanged. Superseding D01 moves its old specimen to the
variant selection without altering its source, policy, verifier or review bytes.
Variants and diagnostics must retain their own denominators in later reporting.

The expanded development-variant and diagnostic suites are version **2.1.0**;
other suite selections are **2.0.0**. The negative-control index is **1.1.0**.
Original suite version 1.0.0 selections and saved results are not rewritten.

| Issue | New core definitions | Consequential evidence                                                                                                                                                                                                                                            |
| ----- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #12   | D01–D08              | Additive quote build-up; stored/legacy/manual/unpriced revisions; incorrect payment amount; scope contradictions; owner block and contract precedence; exact/unreadable insurance identifiers; root-stage grouping, waived work and prior claims                  |
| #13   | D09–D12, T07/T08     | Nested checklist items and requirements; issued artifacts versus forms/notifications; latest developer decision and verbatim reason; stale/indeterminate title evidence; unsent replacement refusal; cancelled surveyor outreach                                  |
| #14   | T01–T06, T09/T10     | Focused lead clarification; acknowledgement loss and duplicate creation; narrow active-revision edits; signing/recall boundaries; missing milestone facts and rollups; deterministic stale requirements refresh; booking ownership/overlap; pending rate requests |
| #15   | T11/T12              | Last-admin preservation; useful site summary despite untrusted role/overwrite/exfiltration instructions; separately selected capability, interaction and fault diagnostics                                                                                        |

The three alternate compliance readiness packs analyze office-engaged architect
plans lacking client approval, an unresolved stale-title alert and DA routing.
Their own frozen workflow checklist is supplied to the candidate. They run in
the **documents** profile: CERTIFIER outreach and those operational resolutions
are outside the minimum SURVEYOR bridge. They do not claim those actions execute.

## Authoring and hidden controls

`src/fixtures/authoring/index.ts` selects explicitly written case specs. The builder
normalizes each source and resolves each evidence substring to exactly one unit.
Generated rubrics record exact locators, atomic expectations, critical gates and
required prose labels. Original synthetic Markdown, CSV, JSON and RFC 822 messages
provide discovery, conflict and missing-information work. OCR-like text is supplied
as text; these controls do not validate visual OCR accuracy.

Task schema **1.2.0** adds the explicit core/variant/diagnostic role, `variantOf`
and hidden control/environment hashes. New cases use policy **1.1.0**; the original
specimens retain policy 1.0.0. Neither policy asserts current statutory correctness.
Every new case has a hidden reference and at least one consequential negative
control. Semantic criteria remain ungraded in offline control checks.

Candidate input is still a closed allowlist of declared documents, policy, brief,
tools and deliverables. Rubrics, seeds, reference outputs, verification plans,
controller options and provenance are excluded. `validate` checks every suite;
run preflight independently requires actual review of provenance/worlds,
verifiers, controls and, where present, environment/operator scripts.

RFC 822 inputs use CRLF. `.gitattributes` preserves their exact bytes so Git
checkout cannot silently change the task input hashes. Generated files and schemas
remain excluded from Prettier; their generators own the frozen bytes.

## Reproduce the offline controls

```sh
pnpm lab controls
pnpm lab controls offers/reconcile-quote-build-up/estuary
pnpm fixtures:generate --check
pnpm schemas:export
pnpm check
```

`controls` checks all **19 authored document packs**, including the read-only
compliance variants. It compares every deterministic verdict with the hidden
expectation. It does not call candidates or judges, grant review or produce a
comparable model score. A failing control is a measurement-system defect.

With the unchanged private pin, prepared bridge and disposable Compose PostgreSQL
service described in [setup](getting-started.md):

```sh
pnpm test:integration -- integration/authored-tools.test.ts
pnpm test:integration
```

The authored tool lane exercises **66 trajectories over 22 packs**, followed by
the no-leftover-databases check. It uses offline scripted HTTP through the actual
serial candidate loop, exact owner approvals and canonical bridge commands.
Each trajectory starts from clean parameterized synthetic rows, with no seeded
business history, journal, approvals, port effects or controller injections.
Independent state, trace, controller events and grades are saved under ignored
`tmp/authored-controls/`. These are synthetic measurement evidence.

Acknowledgement loss withholds a committed response while independent state retains
the effect. Blind new-call retries fail duplicate or unsafe-attempt gates. Existing
canonical integration controls also verify exact same-call replay. Stale requirements
injection fires between the first read and first write through the canonical command;
refreshing arguments requires fresh exact approval. No product rule is reimplemented.

Reader timeout and child-reader error diagnostics use a trusted read-only controller
fault before dispatch. It fires once at the configured occurrence, records the
failure separately and never simulates a committed write. Their environments are
version **1.1.0**. They do not exercise a real provider timeout or a deployed child
specialist. Ambiguous committed-write behavior is covered separately by lost
acknowledgement controls.

The nested trace prototype compares durable operation identity with the exact
session/call/tool of observed successful executions. A parent call with the same
call ID or a different tool cannot hide a child commit. Wrong-session approval
binding is also covered by offline interaction tests; the scripted operator does
not transport arbitrary external-session messages. Royal Eve remains #18 work.

## Review and execution boundaries

Issues #12–#15 remain open because their reviewed-pack acceptance criteria are not
satisfied. Review the source packs, both policies, worlds, hidden rubrics/verifiers,
controls, seeds, operator branches and canonical capability limits together.
Record actual reviewer identity, scope, time and amendments; preserve versions and
hashes deliberately. Intended builder policy overrides product behavior. Any
disagreement must be recorded and the affected bridge case remain unsupported.

The CLI still executes only explicitly opted-in, reviewed single document trials.
The fixed-tools API and offline trajectories do not deliver general suite execution,
repeated experiments, reports or Royal Eve deployment. Cases and scripts remain
review-blocked. Paid candidate/judge calibration and empirical injection resistance
remain #21/#19 work; offline controls establish guards and grading behavior only.

Start review with [the business review pack](review-pack.md). Keep all code,
datasets, control artifacts and later results private/proprietary.
