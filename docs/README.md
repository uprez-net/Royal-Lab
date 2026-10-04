# Royal-Lab documentation

Royal-Lab measures how reliably an LLM or agent can handle NSW residential builder
office work. A case gives it a fictional assignment, documents and business policy;
the harness records its explanations and actions, and independent checks assess
its facts, artifacts, permissions and effects. Intended builder policy is the
authority. Royal-Construction supplies canonical operational commands, not the
expected policy for every builder.

The current repository has 28 task definitions and 52 case packs carrying
the recorded owner review (see [review pack](review-pack.md)),
a closed document workspace, candidate transports, deterministic verification and
a tested minimum canonical bridge covering lead tools and T03–T12 boundaries. It is an implementation under development,
with no approved benchmark release or paid model baseline. Review gates are real:
an offline validation pass does not permit execution of draft cases, and any case
authored later stays draft until a new review is recorded.

## Reading order

| Guide                                           | What it explains                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Getting started](getting-started.md)           | Dependencies, environment assumptions, fresh setup, Docker, private checkout, verification and troubleshooting |
| [Architecture](architecture.md)                 | Components, trust boundaries, case lifecycle, evidence, approval/replay and scoring                            |
| [Configuration](configuration.md)               | Inputs to obtain from the owner, explicit local configuration, credentials and pricing                         |
| [Execution](execution.md)                       | Candidate loop, budgets, current CLI/API support and saved evidence                                            |
| [Experiments](experiments.md)                   | Repeat matrices, paired order, spend ceilings, immutable trial bundles, resume and regrading                   |
| [Reporting](reporting.md)                       | Reports, denominators, compatible paired comparisons, safe exports and offline/paid CI                         |
| [Royal Eve staging](eve-staging.md)             | Composed-agent staging profile, credentials, nested traces, durable evidence import and limits                 |
| [Semantic grading](semantic-grading.md)         | Scoped judges, preserved disagreements, offline replay and pending real calibration                            |
| [Issue closeout](issue-closeout.md)             | Completed checkpoints and outstanding work consolidated into issue #21                                         |
| [Measurement specification](benchmark-spec.md)  | Domain, profiles, success definition, denominators, comparison rules and planned scope                         |
| [Task authoring](task-authoring.md)             | Synthetic case design, hidden expectations, review and versioning                                              |
| [Contracts](contracts.md)                       | Schemas, hashes, safe paths and cross-file validation                                                          |
| [Business review pack](review-pack.md)          | Policies, worlds, specimens and authored expectations needing actual builder review                            |
| [Draft case library](authored-cases.md)         | D01–D16/T01–T12 packs, variants, diagnostics, controls and review boundaries                                   |
| [Document workspace](document-workspace.md)     | Readers, citations, extraction gaps and isolated binary parsing                                                |
| [Canonical bridge](guri-bridge.md)              | Pinned product commands, disposable databases and independently observed effects                               |
| [Operational controls](operational-controls.md) | Minimum T03–T12 adapters, canonical stale-version execution, recording ports and cleanup evidence              |
| [Verification record](verification.md)          | Checks that have passed and the limits of that evidence                                                        |

For source decisions, see [runner/domain reuse](decisions/0001-runner-and-domain-reuse.md)
and [execution boundaries](decisions/0002-execution-boundaries.md).
[The source audit](audit.md), [case matrix](capability-matrix.csv) and
[tool matrix](tool-capability-matrix.csv) connect the roadmap to product capabilities.

## Current readiness

| Activity                                                                             | Available now                        | Required input                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------- |
| Inspect cases, use TUI, validate drafts, export schemas, build and run offline tests | Yes                                  | Node 24 and pinned pnpm dependencies                                                    |
| Parse PDF/DOCX/XLSX locally                                                          | Yes                                  | Docker and the built parser image ID                                                    |
| Exercise canonical lead and minimum T03–T12 boundaries in integration controls       | Yes                                  | Private pinned checkout, prepared bridge and disposable Compose database                |
| Run a reviewed document trial through direct OpenAI or AI Gateway                    | Implemented, draft specimens blocked | Actual review, exact candidate configuration, local credential, pricing and paid opt-in |
| Run the full operational catalogue                                                   | No                                   | Actual case/script review, suite execution and remaining capability support             |
| Produce a fully graded, comparable benchmark score                                   | No                                   | Complete reviewed cases, orchestration and actual judge calibration                     |

Code, datasets and results remain private/proprietary. The synthetic database is
disposable; real client records, product templates and production credentials are
outside this repository's inputs.
