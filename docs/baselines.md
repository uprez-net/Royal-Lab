# v0.1 baselines

The v0.1 baseline compares two candidate configurations on every core case of
the frozen [release manifest](../releases/v0.1.json). It also checks that the graders
separate useful work from deliberately weakened work.

## Candidate configurations

Documents experiments 1.1.0 run on documents profile 1.2.0 (`read` 1.1.0). Experiments 1.0.0 ran on
profile 1.1.0; see [results](results-v0.1.md#first-pass-on-documents-profile-110).

Both configurations are reached through the AI Gateway with zero transport retries.
Their settings and pricing are pinned in each experiment spec.

| Configuration  | Model                 | Parameters         | Price (USD per million tokens, 2026-10-04) |
| -------------- | --------------------- | ------------------ | ------------------------------------------ |
| `gpt-6-luna`   | `openai/gpt-6-luna`   | reasoning `medium` | input 0.10, cached 0.01, output 0.50       |
| `gpt-5.6-luna` | `openai/gpt-5.6-luna` | reasoning `medium` | input 0.20, cached 0.02, output 1.20       |

Neither is the Royal Eve product model. Model order is paired and seeded per
experiment, so position effects do not favour one configuration.

## Experiments

Each experiment runs one suite: 2 configurations × 3 repeats × every case in it.

| Experiment                                                                     | Suite                     | Cases | Trials | Candidate cap | Judge cap |
| ------------------------------------------------------------------------------ | ------------------------- | ----: | -----: | ------------: | --------: |
| [`v0.1-documents-development`](../experiments/v0.1-documents-development.json) | `development` 2.1.0       |     8 |     48 |         $2.50 |     $3.00 |
| [`v0.1-documents-held-out`](../experiments/v0.1-documents-held-out.json)       | `held-out` 2.1.0          |     8 |     48 |         $2.50 |     $3.00 |
| [`v0.1-tools-development`](../experiments/v0.1-tools-development.json)         | `fixed-tools-development` |     6 |     36 |         $2.00 |     $3.00 |
| [`v0.1-tools-held-out`](../experiments/v0.1-tools-held-out.json)               | `fixed-tools-held-out`    |     6 |     36 |         $2.00 |     $3.00 |
| **Total**                                                                      |                           |    28 |    168 |         $9.00 |    $12.00 |

The dry-run plans expected about $3.79 of candidate spend and $0.52 of judge spend.
Each trial has its own ceiling: $0.50 candidate and $0.25 judge. Unknown cost is
never treated as $0.

Deterministic gates (`deterministic-1.2.0`) grade every trial. The calibrated
release judge pair `release-deepseek-qwen` 1.3.0 (`deepseek/deepseek-v4.1-flash` +
`alibaba/qwen3.7-flash`, prompt `criterion-1.1.0`) grades the semantic criteria.
Its calibration rests on provisional labels; see [calibration](calibration.md).
Deterministic domain and state gates stay authoritative; a judge can never pass
a trial that failed them.

## Weakened controls

The weakened baselines are the authored negative controls: hidden wrong outputs
that each pack must fail. The reference output must pass. `pnpm lab controls`
grades them offline, with no model call:

- **Document packs:** 23 packs, 23 of 23 references pass, and 67 of 67 negative
  controls are caught (2026-10-05).
- **Planted failure modes:**
  - wrong amount (17), wrong decision (15), wrong identifier (7), invented
    value (6), wrong date (4), wrong party (5)
  - false success (5), unapproved write (2), duplicate write (1), followed
    injection (1)
  - fabricated citation (1), false discrepancy (2), missed discrepancy (1)
- **Fixed-tools packs:** controls run in the integration suite against disposable
  databases. They cover no tool use, fabricated completion, missing audit,
  duplicate replay, wrong responder or session, and unsafe effects. See
  [operational controls](operational-controls.md) and [verification](verification.md).

Controls are graded on facts and effects, not length, so verbose template answers
fail them.

## How to run

Paid execution is explicit. Dispatch **Paid benchmark (manual, bounded)** with:

- `experiment`: one of the files above;
- `max_candidate_usd`: at least that experiment's cap;
- `max_judge_usd`: `3`;
- `confirm`: `RUN-PAID`.

Document experiments need only the gateway keys. Fixed-tools experiments also need
the `ROYAL_CONSTRUCTION_READ_TOKEN` environment secret. Use a fine-grained,
read-only token for the pinned bridge source.

To run locally, follow [getting started](getting-started.md), then use
`pnpm lab plan`, `pnpm lab sweep --allow-paid` and `pnpm lab report`.
