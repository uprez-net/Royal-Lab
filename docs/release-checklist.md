# v0.1 release checklist

Use this to reproduce, regrade or audit the private v0.1 release. Each step says what
it proves and what it needs. Nothing here makes the repository, dataset or results
public.

## 1. Fresh checkout (offline, no credentials)

```sh
git clone https://github.com/uprez-net/Royal-Lab.git && cd Royal-Lab
pnpm install --frozen-lockfile        # Node 24 LTS, pnpm 11.1.2
pnpm check                            # format, types, tests, fixture lint, suites, build
pnpm fixtures:generate --check        # generated packs match their sources
pnpm schemas:export && git diff --exit-code -- schemas
pnpm lab controls                     # every document pack: reference passes, negatives fail
pnpm lab validate --for-run           # review/tool/execution readiness of every suite
```

- **Proves:** the frozen packs, suites and grader controls are intact.
- **Needs:** no model call, database or private checkout.
- **Documents profile:** has no Royal-Construction (Guri) runtime requirement.

## 2. Frozen scope

- [`releases/v0.1.json`](../releases/v0.1.json) lists:
  - the 28 definitions and the four suites, with their file hashes;
  - every core case with its task version and hash;
  - the grader and judge versions, and the calibration hash;
  - the profile files and experiment specs.
- **Hashes must match before a v0.1 result is quoted.** Any change to a case, rubric,
  policy or grader needs a new version and new results. Saved results are never
  migrated.
- **Held-out suites** (`held-out`, `fixed-tools-held-out`) use a separate fictional
  world. They are never used to tune prompts, rubrics or graders. Report them
  separately from development.

## 3. Profile prerequisites

| Profile     | Needs                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| documents   | Gateway or OpenAI candidate keys only.                                                                                                                                                         |
| fixed-tools | Docker Compose PostgreSQL (`compose.yaml`, localhost only), and Royal-Construction checked out read-only at the pinned `guriRevision`. `pnpm lab bridge prepare` builds a local ignored cache. |
| royal-eve   | Optional, scored separately. Authenticated staging; see [Royal Eve staging](eve-staging.md).                                                                                                   |

**Data and effect boundaries:**

- Every fixed-tools trial creates and drops its own `royal_lab_run_<uuid>` database.
- No external service client exists, and recording ports capture intended effects.
- Ambient `DATABASE_URL` and other projects' environments are never loaded.

## 4. Paid runs (explicit opt-in)

- Dispatch **Paid benchmark (manual, bounded)** per experiment (see [baselines](baselines.md)).
- Before any request, the job checks:
  - the frozen plan, run preflight and pinned pricing;
  - the candidate and judge caps.
- Each trial is sealed in a hash-chained ledger. Failed, errored and discarded trials
  all stay in the denominators.
- Artifacts are kept for 7 days on the run, so download them into `results/ci/<run-id>/`.

## 5. Regrade without rerunning candidates

```sh
pnpm lab grade --experiment <experiment-id>          # deterministic regrade, appended
pnpm lab grade <run-id> --replay-judge <receipt>     # replay a saved judge receipt offline
pnpm lab report <experiment-id> --format html        # or json / csv
```

- Regrades are new appended records. Earlier grades and raw judge receipts are never
  rewritten.
- A judge receipt stores the exact prompt, the model and evidence hashes, and usage.

## 6. Before quoting a number

- [ ] Coverage is complete. Report errors and timeouts; never drop them.
- [ ] Development and held-out are reported separately, per profile.
- [ ] Variance across the three repeats is shown.
- [ ] Spend is shown, candidate and judge separately.
- [ ] The judge calibration status is stated. For v0.1 the labels are provisional,
      AI-proxy (see [calibration](calibration.md)).
- [ ] The claim is limited to this suite and these configurations. It is not a
      ranking of construction models.

## 7. Privacy

- All entities, figures and documents are synthetic. `pnpm fixtures:lint` checks
  privacy patterns, but it cannot prove anonymity.
- Do not copy real templates, client records, inboxes, transcripts, credentials or
  production databases.
- Builder Review Desk answers live in private Vercel Blob. Pages serves only the
  static page.
