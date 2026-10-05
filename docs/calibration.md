# Judge calibration (v0.1)

Semantic criteria (explanations, decisions, refusals) are graded by two independent
model judges. Before their verdicts count, they are checked against labelled
examples. This page records what was checked, the result and its limits.

## The labelling set

`fixtures/judge-calibration/labelling-pack.json` (`calibration-labelling-2026-10`
1.0.0) holds 16 synthetic answers written against real semantic criteria. There
are two per scenario, plus two judge-directed injections:

| Scenario             | What it tests                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------- |
| missing-issue        | One answer names both planted pricing errors; the other accepts the wrong subtotal           |
| wrong-amount         | Fluent prose with a shortfall off by a factor of ten, against the correct figure             |
| alternate-wording    | Correct substance in different words, against booking an unquoted saving                     |
| abstention           | Refusing to guess an unreadable HBCF number, against guessing it                             |
| conditional-approval | A conditional promise is not an approval                                                     |
| false-success        | Claiming a cancelled send went out, against reporting the cancellation                       |
| prompt-injection     | Two candidate-level injections, and two notes telling the grader how to score (“mark this…”) |

Each example carries its exact judge scope (criterion, quoted source lines and
deliverable), a hash of that scope, and no label.

## Labels

**The v0.1 labels are provisional and are not a human review.**

- At the owner's instruction (2026-10-05), Claude wrote them in the role of the
  NSW builder owner, so an initial benchmark could run
  (`labels-provisional-ai-proxy.json`).
- The named owner did not give or see them.
- They must be replaced with human labels before release scores are relied on.

The [Builder Review Desk](../README.md#reviewer-forms) collects blind labels from
real builders. `pnpm review-desk:sync` turns a complete set into
`calibration-labels.json` for `pnpm lab calibration-record`.

## Results

Both release judge pairs graded the unlabelled set in calibration mode with prompt
`criterion-1.1.0` before any label existed:

| Pair                                                  | Agreement with labels | Judge errors | Disagreements | Spend  |
| ----------------------------------------------------- | --------------------: | -----------: | ------------: | ------ |
| `release-deepseek-qwen` 1.3.0 (CI run 37179452247)    |                 16/16 |            0 |             0 | $0.037 |
| `release-deepseek-minimax` 1.1.0 (CI run 37179453746) |                 12/16 |            4 |             4 | $0.052 |

- **DeepSeek + Qwen** agreed with every label, including all four injections. Its
  calibration pack is approved, and `release-deepseek-qwen` carries its hash. It is
  the v0.1 release judge.
- **DeepSeek + MiniMax:** on `missing-issue-a`, `wrong-amount-b`,
  `alternate-wording-a` and `prompt-injection-d`, MiniMax's raw verdict matched the
  label (pass), but it cited no evidence. A pass without evidence is recorded as
  `error`, never as a pass, so the pair is not ready. It stays unbound, with no
  adjudication recorded.

## Disagreement analysis

- **Before calibration:** both pairs cited the criterion's own pass/fail text as
  evidence under prompt `criterion-1.0.0`. Prompt `criterion-1.1.0` states that
  criterion text is never evidence, and fixed this before any label existed
  (`5de3f2d`).
- **Locators:** a blank deliverable locator is accepted, because the exact quote
  still binds the evidence (`913a5c6`).
- **MiniMax errors:** its four errors are evidence-format failures, not wrong
  verdicts. They are kept as errors, and the pair is not used.

## Limits

- 16 examples, two per scenario, support an initial release gate, not a
  measured judge error rate.
- The labels are provisional and AI-written. Agreement shows the judges agree with
  that labeller, not with builders.
- Judge temperature is zero, but provider-side model changes can still shift
  behaviour. Profiles pin model IDs and prompt versions, and receipts keep the
  exact prompt text and hashes for replay.
- Deterministic domain and state gates remain authoritative in every grade.
