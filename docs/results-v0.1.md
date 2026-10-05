# v0.1 results (private)

The first v0.1 baselines ran on 2026-10-05 against the frozen
[release manifest](../releases/v0.1.json): `gpt-6-luna` vs `gpt-5.6-luna`, three repeats
of every core case, judged by the calibrated `release-deepseek-qwen` pair.

- **Done:** the documents profile, 16 cases and 96 trials.
- **Not yet run:** the fixed-tools profile (12 cases, 72 trials). Its CI run needs
  read access to the pinned bridge source.

**This is an initial comparison on a small private suite, not a ranking of
construction models.** No trial was dropped. Failed, errored and ungraded trials stay
in every denominator.

![How every v0.1 trial ended](images/v0.1-outcomes.svg)

![Strict successes per case](images/v0.1-cases.svg)

## Outcomes

| Partition               | Configuration  | Strict pass | Failed | Not fully graded | Candidate failure | Trials |
| ----------------------- | -------------- | ----------: | -----: | ---------------: | ----------------: | -----: |
| Documents · development | `gpt-6-luna`   |           3 |      5 |               15 |                 1 |     24 |
| Documents · development | `gpt-5.6-luna` |           1 |      0 |                7 |                16 |     24 |
| Documents · held-out    | `gpt-6-luna`   |           3 |      1 |               17 |                 3 |     24 |
| Documents · held-out    | `gpt-5.6-luna` |           1 |      0 |                8 |                15 |     24 |

- **Strict pass:** every mandatory criterion passed, both deterministic and judged.
- **Failed:** fully graded, with at least one mandatory criterion failed.
- **Not fully graded:** the run completed, but a criterion could not be settled. The
  causes are a judge disagreement awaiting human adjudication, a judge error, or a
  prose figure the deterministic checker could not find.
- **Candidate failure:** the model ended the trial with a tool call the workspace
  rejected.

**No comparable headline rate exists**, because a headline needs every completed trial
fully graded. The report says so rather than estimating one.

Strict passes came almost entirely from `analytics/project-cost-margin`:

- **D14 (development):** `gpt-6-luna` passed 3/3, `gpt-5.6-luna` 1/3.
- **D14 (held-out):** the strongest case for both configurations.

Critical gates, the money, date, party and effect errors, passed in every graded
held-out trial for both configurations. In development they passed in 62.5% of graded
`gpt-6-luna` trials, failing on wrong parties and missing evidence.

## Cost and speed

| Experiment                   | GitHub run  | Candidate spend | Judge spend | Median trial time                             |
| ---------------------------- | ----------- | --------------: | ----------: | --------------------------------------------- |
| `v0.1-documents-development` | 37258613011 |           $0.09 |       $0.38 | 17.0 s (`gpt-6-luna`), 4.5 s (`gpt-5.6-luna`) |
| `v0.1-documents-held-out`    | 37258615393 |           $0.11 |       $0.44 | 18.8 s (`gpt-6-luna`), 4.6 s (`gpt-5.6-luna`) |

Judge spend includes the reserved ceiling for receipts whose usage the provider did not
confirm. Both runs stayed far inside their caps ($2.50 candidate and $3 judge each).
The short median time for `gpt-5.6-luna` reflects its early terminations.

## Measurement-quality findings

These are what v0.1 exists to surface. They are findings, not grading changes, and
the existing grades are kept.

1. **Live judge disagreement is much higher than calibration suggested.** On the
   labelling set, DeepSeek and Qwen agreed with every label. On real answers, 32
   semantic criteria ended in disagreement (12 in development, 20 in held-out), and 4
   in judge errors.
   - Most disagreements are Qwen answering "pass" without citing evidence. That is
     recorded as an error, so it disagrees with DeepSeek's verdict.
   - DeepSeek's errors were a timeout and a truncated response.
   - Disagreements wait for human adjudication, and none is invented.
2. **Prose figures often cannot be verified.** 54 deterministic prose checks found no
   scoped `Key figures` line in `review.md`. The answer had the figure elsewhere, or
   no line in the requested `Label: value` form. Such checks stay unverified, not
   failed, by design.
3. **`gpt-5.6-luna` mostly ends on rejected tool calls:** 31 of its 48 trials. Earlier
   sweeps traced these to `read` calls asking for more than 100 lines. Whether to
   soften that protocol is an owner decision. Changing it means a new profile version
   and new runs.
4. **The judge calibration rests on provisional, AI-written labels.** See
   [calibration](calibration.md). Finding 1 suggests the labelling set is too easy to
   separate these judges.

## What is needed to finish v0.1

- **Fixed-tools runs:**
  - give `ROYAL_CONSTRUCTION_READ_TOKEN` read access to Royal-Construction;
  - dispatch `v0.1-tools-development` and `v0.1-tools-held-out` (see
    [baselines](baselines.md)).
- **Adjudication:** a human resolves the 32 judge disagreements, as append-only
  records. Alternatively, accept "not fully graded" for v0.1 and fix judge evidence
  in a new profile version.
- **Owner decisions:** the `read` protocol limit, and whether `Key figures` is a
  hard requirement.

## Reproduce

The trial bundles are in the run artifacts (copied to `results/experiments/<id>`).
Regenerate everything offline:

```sh
pnpm lab report v0.1-documents-development-20261005031457-9409cfa1 --format json
pnpm lab report v0.1-documents-held-out-20261005033354-f5ef461c --format json
node scripts/results-charts.mjs        # writes docs/images/v0.1-*.svg and v0.1-summary.json
```
