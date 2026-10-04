# Repeated experiments, spend limits and immutable trial bundles (#16)

An experiment is the case selection × candidate configuration × repeat matrix.
The whole matrix is frozen before any candidate request. Every trial then ends in
an explicit terminal state, and saved bundles are sealed. Implementation:

| Path                          | Responsibility                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `src/contracts/experiment.ts` | Experiment spec, frozen plan, hash-chained ledger events and bundle receipts     |
| `src/runs/manifest.ts`        | Offline planning, full-suite preflight, case/config/runtime hashes, dry-run text |
| `src/runs/scheduler.ts`       | Seeded paired order, bounded concurrency, resource serialization, external lock  |
| `src/runs/budget.ts`          | Spend estimates, per-trial/aggregate ceilings, termination classification        |
| `src/runs/artifacts.ts`       | Write-once plan, append-only hash-chained ledger, sealed trial bundles           |
| `src/runs/resume.ts`          | Trial states, interrupted-trial preservation, reruns as new trials               |
| `src/runs/sweep.ts`           | Trial execution, sealing, deterministic grading records and regrading            |

## Commands

```sh
pnpm lab plan --experiment templates/experiment.example.json      # dry run, no writes
pnpm lab sweep --experiment <file> --allow-paid                   # freeze, then execute
pnpm lab resume <experiment-id> --allow-paid                      # unstarted trials only
pnpm lab grade --experiment <experiment-id>                       # new grade records
```

`plan` prints every case in the suite with its status: planned, execution-ready,
excluded or not ready. It also prints the configurations, repeats, seed and every
trial (sequence, repeat, paired block/order, configuration and case), plus the
expected and bounded candidate/judge spend and their assumptions. It never resolves
a credential. `sweep` writes `plan.json` and the ledger first, so a blocked
attempt is still recorded. It then refuses to start unless the full-suite run
preflight passes. Draft packs therefore keep every current sweep blocked.

The CLI executes the documents profile. The trial executor is an injectable
interface, and fixed-tools and Royal Eve executors plug in through it. Royal Eve
trials share the `royal-eve-staging` resource. They run serially and require an
explicit `--lock-file` on storage shared by every runner. That lock is never broken
automatically.

## Matrix, order and isolation

- The default is three repeats. For each (case, repeat) block, the configuration
  order is a seeded SHA-256 permutation, and the seed, block and order are saved
  for every trial. Fixtures, clock and tools are identical within a block.
- Each trial has its own directory and a fresh document workspace. Repeats cannot
  read another trial's outputs. Credentials are resolved per trial from the named
  variable only. They never enter the workspace, plan or ledger, and traces are
  sanitized.
- Shared resources are serialized through resource locks. Fixed-tools trials share
  bridge provisioning but each uses its own run database. Royal Eve staging is
  serial with an external lock.

## Frozen identity

The plan records hashes for the suite, profile, prompt, tool schemas, parser
profile and lockfile. It also records the runner revision and dirty state, Node
version, Guri pin and judge profile. Each case records its task, fixture, rubric,
provenance, verifier, policy, sources, controls and environment hashes. Each
configuration records its provider, model, parameters and pricing hash. The plan
hash covers all of it, and reopening an experiment refuses a changed plan. A
benchmark sweep requires a clean checkpointed runner. A trial whose task hash
differs from the plan fails before any request.

## Spend and ceilings

- Per-trial candidate ceiling = min(task token ceilings at frozen pricing, task
  `maxCostUsd`, experiment `perTrialCandidateUsd`). The candidate loop additionally
  enforces turn/token/time/cost ceilings and zero SDK retries (`transportRetries: 0`).
- Before admitting a trial, the sweep reserves its ceiling. It stops before the
  next trial if spend so far plus in-flight reservations plus that ceiling would
  exceed `totalCandidateUsd`. It also stops when the experiment wall-clock ceiling
  is reached.
- Unknown usage is never $0. A trial with unknown cost (missing usage, a failure
  without a result, or an interruption) is charged its worst-case reservation and
  reported separately as `unknownCandidateTrials` / `unknownCandidateBoundUsd`.
  If no positive bound exists, all further paid admission stops.
- Judge calls are estimated from semantic criteria × judges. Unpinned judge pricing
  makes the expected judge spend `null` (unknown).
- Semantic judging in a sweep: when the experiment names `judgeProfile` and
  `judgeApiKeyEnv`, every completed trial is judged right after its deterministic
  grade, in one appended grade record whose `graderVersion` names the judge
  profile (`deterministic-1.2.0+<profile>@<version>`). The profile must match the
  hash frozen in the plan, and its per-call `maxCostUsd` must not exceed
  `perTrialJudgeUsd`. Each judged trial reserves that ceiling against
  `totalJudgeUsd` and settles to the recorded judge cost (unknown cost keeps the
  full reservation). When the next reservation would exceed the total, the trial
  keeps its deterministic grade, the semantic criteria stay ungraded and a
  `JUDGE_BUDGET_EXHAUSTED` grading error is reported. Release profiles still need
  an approved calibration; sweeps use exploratory profiles until then.
- The paid workflow takes a separate `max_judge_usd` cap (default `0`, which
  refuses any experiment with a judge profile) and the `ROYAL_LAB_JUDGE_KEY`
  environment secret.

## Terminal states and coverage

| Status                 | Classification              | Denominator consequence                               |
| ---------------------- | --------------------------- | ----------------------------------------------------- |
| `completed`            | completed                   | Graded candidate trial; completion is not correctness |
| `candidate-failure`    | candidate failure           | Failed trial                                          |
| `budget-exhausted`     | candidate resource ceiling  | Failed trial                                          |
| `budget-stopped`       | experiment resource ceiling | Missing coverage; no comparable headline              |
| `interrupted`          | interrupted                 | Missing coverage; never rerun under the same ID       |
| `infrastructure-error` | infrastructure error        | Invalid; coverage incomplete                          |
| `blocked-input`        | blocked input               | Invalid; no candidate request                         |
| `excluded`             | excluded                    | Reported with its reason, outside the denominator     |

Resume marks started-but-unfinished trials `interrupted` and runs only unstarted
trials. An explicit rerun is a new trial ID that references the original. The
original stays in the ledger and the denominator, so a failure cannot be replaced
by a later success.

## Immutability and regrading

The plan is written once. The ledger is append-only, and each event's hash covers
the previous hash. Duplicate starts/finishes, unknown trials and edits are refused
on reopen. When a trial finishes, its directory gets `bundle-receipt.json` with
every file hash, and the ledger records the receipt hash. Regrading verifies the
bundle, then writes a new `grade-<uuid>.json` and a `trial-graded` event. Earlier
grades and raw judge receipts are never rewritten.

Experiment results live under ignored `results/experiments/`. `retention.traceDays`
is recorded in the plan as the private retention decision. Deleting expired
staging transcripts remains an explicit operator action.

## Verified offline

`tests/experiments.test.ts` covers the following with offline mock transports and
temporary roots, and makes no paid request:

- Two configurations × three repeats produce six unique sealed bundles, with no
  workspace leakage.
- Bundle and ledger tampering are detected.
- Interruption and resume, a failed attempt kept beside its rerun, and appended
  regrades.
- Budget-stopped and unknown-usage bounds, the wall-clock ceiling, locks, and the
  CLI dry run.

These controls are not a model result. Draft packs remain blocked; the packs
covered by the recorded owner review are execution-ready.

## Grader versions

Every `trial-graded` ledger event records its grader version; regrades append and
never rewrite earlier grades.

- `deterministic-1.1.0`: the original prose parser.
- `deterministic-1.2.0` (2026-10-04): prose checks ignore bracketed
  `[source locator]` citations, read counts with thousands separators (`1,776`)
  as one number, and treat `,` and `;` as the same list separator (order still
  matters). The first live sweep showed 1.1.0 failing correct values written in
  those forms; every document grader control still produces its declared
  verdicts under 1.2.0. Compare results only within one grader version.
- A regrade recreates an empty `outputs/` directory for a trial that recorded no
  output files, because artifact transports drop empty directories.
