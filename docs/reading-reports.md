# Reading a Royal-Lab report

A report summarises one **experiment**: one suite of cases, two or more model
**configurations**, and several **repeats** of every case for each configuration.
Each run of one case by one configuration is a **trial**. This guide explains every
part of the HTML report, what each number means, and what it does not mean.

Generate a report from saved results, offline and without any model request:

```sh
pnpm lab report <experiment-id> --format html   # also: csv, json
pnpm lab compare <expA>:<configA> <expB>:<configB> [--exploratory]
```

Reports are written to `results/experiments/<experiment-id>/reports/`. The HTML
page is fully static: it loads nothing from the network, runs no script, and
escapes every piece of document, candidate and judge text. Hover tooltips are
the browser's own.

## 1. Header

- **Title**: the profile. _Documents_, _Fixed tools_ and _Royal Eve (composed
  product agent)_ are separate tracks and never share a ranking.
- **Experiment ID**: the folder under `results/experiments/` holding the frozen
  plan, the hash-chained ledger and one sealed bundle per trial.
- **Chips**:
  - mode: `benchmark` (reviewed cases, real paid requests) or `offline-control`
    (mock transports, for testing the harness);
  - suite and version;
  - repeats per case;
  - plan hash: every task, source, rubric, verifier, prompt, tool, parser,
    pricing and model setting was frozen under it before any request;
  - judge profile, if semantic criteria were judged.
- **Notes**: whether the experiment is benchmark-eligible, plus warnings such as
  "repeats are clustered by case". Read these first: they say what the numbers
  can and cannot be used for.

## 2. Summary tiles

| Tile                  | Meaning                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trials                | Every planned trial: configurations × cases × repeats. Nothing is dropped, including failures.                                                                    |
| Critical gates passed | Trials whose critical criteria all passed, out of every trial with a gate verdict. A candidate failure (for example an invalid tool call) counts as failed gates. |
| Strict successes      | Trials in which **every mandatory criterion** passed, semantic ones included. This is the benchmark's success definition.                                         |
| Candidate spend       | Provider-reported cost of the models under test, priced at the frozen pricing snapshot.                                                                           |
| Judge spend           | Cost of the semantic judge calls, kept separate from candidate spend.                                                                                             |

Unknown cost is never shown as $0: a trial whose usage was not reported is
counted as unknown and charged its worst-case reservation in the budget.

## 3. Trial outcomes chart

One bar per configuration, split into the outcome of each of its trials:

| Colour      | Outcome                                     | Meaning                                                                                                                                                                         |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Green       | Strict success                              | Every mandatory criterion passed.                                                                                                                                               |
| Light green | Critical gates passed, not a strict success | No critical fact or action was wrong, but a mandatory non-critical criterion failed or a semantic criterion was not judged.                                                     |
| Red         | Critical gate failed                        | A critical amount, date, party, authorisation, approval, effect or truthfulness check failed. No amount of good prose rescues this.                                             |
| Orange      | Candidate failure                           | The model broke the protocol (for example called a tool with arguments outside its declared schema) or ran out of turns, tokens or budget. It counts as a failed trial.         |
| Grey        | Infrastructure, budget or missing           | The trial could not be judged on the model's merits: a provider or harness error, a budget stop, or an interruption. It is shown, never hidden, and it blocks a headline score. |

Hover a segment for its count.

## 4. Criterion results

Rows are the rubric criteria of each case (for example `C5` = projected margin),
and columns are configurations. Each cell shows how that criterion went across
the repeats:

- **pass**: the frozen expectation was met.
- **fail**: it was not, or the required deliverable was never written.
- **error**: the evidence could not be evaluated, for example a judge returned an
  unusable answer. Errors never count as passes.
- **ungraded**: a semantic criterion with no judge receipt.

**Critical** criteria are the gates; **substantive** criteria still have to pass
for a strict success. `C…` criteria are graded deterministically from the
structured outputs, the trace and independent state. `S…` criteria need a judge.
A whole row in one colour usually points to a systematic behaviour, such as one
model always misreading a source, rather than noise.

## 5. Cost and duration per trial

One dot per trial on one shared axis per measure, coloured by configuration.
Hover a dot for its repeat, case, value and status. Tight clusters mean stable
behaviour; a wide spread at similar quality usually means the model sometimes
takes many more turns. Failed trials appear too, often at the low end because
they stopped early.

## 6. Configuration cards

| Field                   | Meaning                                                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headline (large %)      | Strict success rate over the configuration's valid trials. Shown **only** when every planned original attempt finished and was fully graded; otherwise the card says why there is no comparable headline.                   |
| Planned / completed     | Trials planned, and trials that ended with the model finishing normally (not necessarily correctly).                                                                                                                        |
| Failed / ungraded       | Valid trials that were not strict successes, and completed trials still missing a grade.                                                                                                                                    |
| Invalid / missing       | Infrastructure or blocked trials, and trials that were stopped or never finished. Either one blocks the headline.                                                                                                           |
| Critical-gate rate      | Share of **fully graded** trials whose critical gates all passed. It differs from the summary tile, which also counts candidate failures.                                                                                   |
| Macro family score      | Mean strict-success rate per case family (for example _offers_, _compliance_), then averaged across families so that a big family doesn't dominate. Only shown when complete.                                               |
| Candidate / judge spend | Recorded cost. "+N unknown" marks trials without reported usage.                                                                                                                                                            |
| Tokens in / out         | Total model tokens. Reasoning tokens count as output.                                                                                                                                                                       |
| Duration p50 / p90      | Median and 90th-percentile trial wall time.                                                                                                                                                                                 |
| Outcome: …              | Why non-successful trials failed, by `severity:category` of the failed criteria (for example `critical:money`) or by trial classification (for example `candidate-failure`). One trial can appear under several categories. |
| Per case                | Strict successes / trials for each case, and the within-case variance `p(1−p)`: 0 means every repeat agreed, and 0.25 is maximum disagreement.                                                                              |

## 7. Exclusions

Suite cases outside the experiment's selection, and cases that failed run
preflight, are listed with their reason. They are never silently dropped from
the denominator.

## 8. Trial cards

Trials are grouped by case. The collapsed line shows the configuration, repeat,
outcome, how many criteria passed, grading status and duration. Expand a card to
see:

- **Links** to the sealed bundle, the trace (every model request, tool attempt,
  tool execution, approval and termination), the grade file and the deliverables
  the model wrote.
- **Why this trial did not succeed**: one plain sentence per failed critical or
  mandatory criterion.
- **Criterion details**:
  - **Required**: the frozen expected value from the reviewed rubric.
  - **Actual**: what the model's deliverable said, or a `missing` note when it
    was not written.
  - **Reason**: the grader's verdict reason.
  - **Evidence**: the source locations (`[source-id locator]`) behind the
    expectation, so you can check it against the original documents.
- **Tools**: these four are deliberately kept separate:
  - **attempted**: what the model asked for;
  - **executed**: what actually ran, and its outcome (for example `blocked`);
  - **approvals**: scripted owner decisions;
  - **committed effects**: durable writes or external sends.

  An attempted unsafe action counts against the model even if a guard blocked it.

- **Usage** and **judging**: tokens and spend, plus the number of semantic
  criteria judged, judge disagreements and human adjudication records.

## 9. Run parameters

The frozen identity: suite, profile, runtime and runner revision, judge profile,
seed, repeats, per-case hashes and every configuration's provider, model,
parameters and pricing. Two reports can be compared formally only if these
match.

## Interpreting results safely

- **Exploratory vs release judging.** A single uncalibrated judge (for example
  `glm-exploratory`) makes the semantic verdicts exploratory. Release judging
  needs the two-judge release profile, an approved calibration against
  reviewer-labelled examples, and human adjudication of disagreements (see
  `docs/semantic-grading.md`).
- **Repeats are not new tasks.** Three repeats of one case show stability, not
  breadth. Comparisons resample whole cases, then repeats within them (paired
  cluster bootstrap), and rank only when the 95% interval excludes zero.
- **Held-out cases** are for measurement only; never tune prompts or rubrics
  against their results.
- **Grader versions.** Each grade records its grader version (for example
  `deterministic-1.2.0+glm-exploratory@1.2.0`). Regrades append; earlier grades
  are kept. Compare results only within one grader and judge version.
- **Completion is not correctness.** A model that "completed" can still fail
  every critical gate; only the criteria decide success.
- **Profiles never mix.** A Royal Eve result scores the product agent with its
  own prompts and model, not a model ranking.

## Exports

- **JSON**: the full report object, the same data as the HTML.
- **CSV**: one row per trial, for spreadsheets. Cells starting with `= + - @`
  are prefixed so that spreadsheet tools never evaluate them.
- **HTML**: this page. Every export redacts secrets first.
