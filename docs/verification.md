# Foundation verification — 2026-10-01

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
