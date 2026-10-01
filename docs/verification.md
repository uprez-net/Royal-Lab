# Foundation verification — 2026-10-01

## Execution implementation — 2026-10-02

The #4–#10 implementation was checked on Windows using the official Node **24.21.0**
runtime and pnpm 11.1.2. `pnpm check` covers Prettier, strict TypeScript, **77 offline
tests**, privacy/reference lint, both selected suites and the production build.
The fixture drift check covers **33 generated files**; **14 schemas** are exported.
The original foundation verification below remains a historical record.

The opt-in local integration lane covers isolated Docker PDF/DOCX/XLSX parsing,
the clean private canonical source pin, disposable PostgreSQL writes/history/journal,
approval and cancellation through the actual SDK loop, same-call replay, failed
initialization cleanup and canonical pricing oracle generation. This lane passed
**9 integration tests**. The independent verifier normalizes Prisma's
UTC timestamp columns rather than applying the host timezone. Provider transport
controls use mock HTTP: they are not paid model runs or measured model baselines.

Controls catch wrong totals/units/dates/owners, no durable row, duplicate tasks,
missing scoped history/operation evidence, stale overwrite, changed approval
arguments, wrong responder, unsafe attempts and forged/cancelled/outage/replay
claims. Correct JSON with wrong prose fails. Regrading saved output makes no
candidate request and detects altered artifacts or trace/configuration evidence.
Unknown usage and unanswered provider requests retain null cost/tokens.

The current CLI trial command supports reviewed document cases. The fixed-tools
API is verified for the lead-task slice; broader T03–T12 commands and their stale
version scenarios remain unimplemented. Semantic judging, suite orchestration,
reports/comparisons, full case authoring and model calibration are later issues.
All source/world/case/verifier packs remain draft; no human approval, paid run,
score, production record or real external effect has been created.

## Original foundation record

Verified locally on Windows with Node 25.2.1 and pnpm 11.1.2. The supported setup
is Node 24 LTS. The first [remote offline CI run](https://github.com/uprez-net/Royal-Lab/actions/runs/36891011231)
also passed on Linux with Node 24. The pinned Royal-Construction product tests
were inspected and have not been executed here.

| Check                            | Result                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Passed using the committed lockfile                                                                                                                                         |
| `pnpm check`                     | Prettier, strict TypeScript, 28 tests, privacy/reference lint, both selected suites and production build passed                                                             |
| `pnpm fixtures:generate --check` | 29 canonical generated files matched with no drift                                                                                                                          |
| `pnpm schemas:export`            | 10 portable schemas exported; semantic and cross-file checks remain required                                                                                                |
| Compiled CLI                     | Nine paths verified: list, visible describe, draft readiness rejection, missing arguments, reserved run/grade/report/compare and noninteractive TUI refusal                 |
| Native import aliases            | Source, test and compiled Node resolution passed                                                                                                                            |
| TUI                              | Static 60/80/120-column layouts fit 24 rows; loaded-case pagination, detail view, all suite-result scrolling, fixture checks, setup and quit verified with terminal streams |
| Live Windows terminal            | Alternate screen, case navigation, suite checks and restored screen on quit verified                                                                                        |
| `git diff --check`               | Passed                                                                                                                                                                      |

The negative checks cover missing/altered fixtures, duplicate IDs, invalid portable
paths, symlinks, split leakage, unsupported tools, incomplete repeats/results,
false-success traces, critical failures, judge errors, budget exhaustion,
configuration isolation, candidate-visible separation and Sydney DST conversion.

Repository privacy was verified as private. No production application, model API,
external effect or paid benchmark run was invoked. Four authored cases remain
drafts with no invented human approvals; all 28 definitions have scope entries,
but only the four specimens have source packs. Human business review remains
the outstanding item in #5. Candidate execution and graders are later issues.
