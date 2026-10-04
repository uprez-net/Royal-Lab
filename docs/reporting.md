# Reports, comparisons and CI (#17)

Reports are built offline from an experiment's frozen plan, its verified
hash-chained ledger and sealed trial bundles ([experiments](experiments.md)).
They never contact a provider. Missing evidence is reported as missing: it never
becomes a pass, a zero or a silently smaller denominator.

```sh
pnpm lab report <experiment-id> --format html|csv|json
pnpm lab compare <exp-a>:<config> <exp-b>:<config> [--exploratory] [--format json|html]
```

Both commands write a new file under `results/experiments/<id>/reports/`. Sealed
trial evidence is never modified.

## Separate profiles

Each report is labelled **Documents**, **Fixed tools** or **Royal Eve (composed
product agent)** from the suite profile. A Royal Eve score measures the deployed
product agent and its pinned configuration, not a candidate model. Comparisons
refuse to pool or rank different profiles.

## What a report contains

- **Coverage:** suite cases selected, compatible (offline integrity passed),
  excluded, planned and not ready, with every exclusion's reason.
- **Per configuration counts:** planned, finished, completed, valid (candidate
  outcome), failed, graded, ungraded, invalid and missing trials.
- **Headline:** strict task success over valid planned trials. Every mandatory
  criterion must pass. The headline is `null`, with the exact reason, unless every
  planned original attempt finished and was fully graded. Reruns are listed but
  never enter the headline.
- **Rates and diagnostics:** critical-gate pass rate, macro family score (mean of
  per-family mean case success; only with complete coverage), failure categories
  (`severity:category` of failed criteria, or the termination class), pooled
  criterion diagnostics per case and within-case success rate and variance.
- **Usage:** candidate and judge spend shown separately, unknown-cost trials
  counted, input/output tokens, and latency mean/p50/p90/max.
- **Run parameters:** plan hash, suite/profile/prompt/tool/parser hashes, runtime,
  product pin, judge profile, seed, repeats, per-case hashes and configurations.
- **Per trial:**
  - Status, termination class and coverage consequence.
  - Every criterion with severity, verdict, the required value from the frozen
    rubric, the actual value read from the saved deliverable (or an explicit
    `missing` reason), the original source locators and the grader reason.
  - Concrete explanations such as `CRITICAL C1 …: fail — required 138682500,
actual 121210500`.
  - Attempted tools, executed tools with outcome, approval events and committed
    effects, kept separate. A blocked attempt is called out as guarded, not as
    harmless.
  - Judge criteria, disagreements and human adjudication record counts.
  - Relative links to the bundle, trace, grade and outputs.

## Denominators and interpretation

| Coverage                                                | Headline effect                                 |
| ------------------------------------------------------- | ----------------------------------------------- |
| completed and graded                                    | In the denominator; success needs all mandatory |
| candidate failure / candidate resource ceiling          | In the denominator as a failure                 |
| completed but semantic/judge criteria ungraded or error | Blocks the headline (no complete score)         |
| infrastructure error / blocked input                    | Invalid; blocks the headline                    |
| budget-stopped / interrupted / unfinished               | Missing; blocks the headline                    |
| excluded                                                | Listed with its reason; outside the denominator |

Partial results stay visible as diagnostics with their own counts. They are never
a comparable headline. Unknown candidate cost makes spend totals `null`, and the
report says how many trials are unknown. Planned bounded spend comes from the
frozen plan.

Repeats are clustered by case and are not independent tasks. Variance is reported
within each case.

## Comparisons

A formal comparison requires all of the following:

- the same profile kind, suite (id/version/hash), profile, system prompt, tool
  schemas and parser profile;
- the same product pin, judge profile and repeats;
- the same per-case task/fixture/rubric/provenance/policy/sources/verifier/
  controls/environment hashes;
- benchmark mode with a passing run preflight;
- complete coverage on both arms.

Anything else is refused with the list of mismatches. `--exploratory` produces a
labelled, unranked diagnostic. Two configurations inside one experiment share
every hash by construction.

The statistic is the mean paired per-case difference (B − A) in strict success
rate. The 95% interval comes from a seeded bootstrap that resamples cases, then
resamples each arm's repeats within the case. A formal ranking is reported only
when the interval excludes zero; otherwise it is `no-difference`. Per-case
wins/losses/ties and unpaired cases are listed.

## Export safety

- JSON, CSV and HTML are generated offline from the built report. Values are first
  passed through the configured secret redaction.
- HTML escapes every interpolated string, including document, candidate and judge
  text. It links only relative bundle paths without `..` or a URL scheme, and it
  carries a Content-Security-Policy with `default-src 'none'`, so no script,
  remote load, form or frame runs. No leaderboard service exists.
- CSV quotes delimiters and prefixes formula-leading cells (`= + - @`) so
  spreadsheets do not evaluate them.

## Continuous integration

- `.github/workflows/offline.yml` runs on push and pull requests with no secrets:
  `pnpm check` (formatting, types, tests including grader/harness contracts,
  privacy/reference lint, suite integrity and build), fixture drift, all document
  grader controls, a credential-free experiment dry run that must stay blocked for
  draft packs, and schema drift. It cannot spend model credits.
- `.github/workflows/benchmark.yml` is `workflow_dispatch` only. It requires:
  - the typed confirmation `RUN-PAID` and the `paid-benchmark` environment, which
    accepts deployments from `main` only. The organization's current GitHub plan
    does not offer required reviewers on private repositories, so dispatch is
    gated by repository write access, the typed confirmation and the cap below;
  - environment secrets `ROYAL_LAB_CANDIDATE_A_KEY` / `ROYAL_LAB_CANDIDATE_B_KEY`
    (set privately by the owner; never in the repository);
  - an experiment file under `experiments/` and a dollar cap the plan's bounded
    and total candidate spend must not exceed;
  - pinned judge pricing and a passing preflight;
  - the documents profile only, so no staging/production target is reachable.

  Credentials come only from environment secrets for the sweep step. Experiment
  evidence and reports upload as a private artifact kept for seven days.
  `experiments/preflight-smoke.json` is a wiring check with placeholder models,
  zero pricing and no judge profile: while packs are draft its dispatch must stop
  at the dry run with no model request. It is not a benchmark experiment. No paid
  sweep has run.

Verified offline by `tests/reporting.test.ts`: critical-fact evidence, missing
coverage without a headline, escaped/secret-free exports and CLI files, and formal,
refused and exploratory comparisons. No live model result exists.
