# Scoped semantic grading (issue #11)

The semantic path evaluates only criteria whose rubric method is `semantic`.
`src/grading/judge.ts` projects one criterion's title and pass/fail standard,
declared deliverable text, and exact declared source locators. Hidden evidence
`fact` fields, other rubric criteria, fixture oracles, trace history, configuration,
credentials, and neighboring source units are excluded from the judge request.
Frozen output and normalized source hashes are checked before projection. A missing
or ambiguous locator is an error; the grader never expands to a whole document or
uses fuzzy locator matching. The current draft specimens still need review of
their source pointers; this implementation does not rewrite their rubrics.

The fixed system prompt treats candidate output and source excerpts as quoted,
untrusted JSON data. Neither can create a system message or invoke a tool. Judges
have no tools, retrieval, candidate environment, or shell. Known credential patterns
and explicitly supplied judge keys in evidence are rejected before requests. The
allowlist and credential checks reduce exposure; they are not a universal detector
of arbitrary secrets. Synthetic-only sources and real input review remain required.

Only exact JSON with `verdict: pass|fail|error`, a nonblank `explanation`, and an
`evidence` array is accepted. Non-error verdicts require exact quotations at scoped
pointers. A pass must cite every declared deliverable and supplied excerpt. Missing
evidence, invented quotations, malformed JSON/schema, provider errors, unsupported
settings, truncation, timeout, and unknown usage stay error. Citation validation
establishes provenance, not semantic correctness; real calibration is pending.

## Profiles and execution

`profiles/judges/single-exploratory.json` is a versioned opt-in exploratory template.
`dual-release.json` requires two independently configured judges. Both deliberately
leave model IDs and pricing unset: no model, price, calibration, or reviewer is
invented. Create an ignored private copy, pin models/parameters and timestamped
pricing, and provide per-judge keys in a separate ignored JSON file keyed by judge
ID. Legacy `config.judge` does not enable this path. Judge credentials are never
read from ambient environment variables, `.env`, or `DATABASE_URL`.
Both routes pin explicit endpoints and use the chat protocol; gateway judging uses
the [documented OpenAI-compatible endpoint](https://vercel.com/docs/ai-gateway/openai-compat/rest-api).
Judge requests do not inherit `OPENAI_BASE_URL` or native gateway project metadata.

```sh
# Default remains offline deterministic regrading.
pnpm lab grade <run-id>

# Intentional paid requests against preserved candidate evidence.
pnpm lab grade <run-id> --judge-profile tmp/judge-profile.json --judge-credentials tmp/judge-keys.json --suite suites/development.json --allow-paid

# Offline replay of preserved judge responses: no credentials or paid flag.
pnpm lab grade <run-id> --replay-judge judge-<uuid>.json
```

Every paid path, including the low-level judge API, requires full selected-suite
run preflight and the exact reviewed task/rubric. Draft packs remain blocked by
issue #5's independent review gate. Profiles bound request count, request bytes,
per-request output tokens, total tokens/spend, timeout, and overall duration.
Requests are serial with retries disabled. Input reservation uses UTF-8 bytes plus
protocol overhead; actual provider usage is checked after responses. Provider
overruns and unknown usage block further requests. Frozen pricing reports a
conservative estimate using total input/output tokens; provider billing is not
claimed to be independently verified. Timeout/provider failures may have unknown
usage/cost; these remain null, never zero.

The API's `offline-control` mode requires an explicitly supplied mock HTTP transport
and labels its receipts. `calibration` mode permits deliberately opted-in dual
evaluation before release calibration approval; it still requires real run preflight.
No ordinary validation, test, calibration inspection, or offline replay calls a live
judge. Fresh semantic rejudging of saved evidence requires a new paid opt-in and
creates a new receipt; it never reruns the candidate.

## Evidence, scoring and adjudication

`judge-<uuid>.json` is a separate schema `1.0.0` artifact. It retains the full
versioned judge profile, prompt bytes/hash, implementation hash, Node/lockfile/SDK
identity, execution/rubric/deterministic fingerprints, scoped requests, and every
judge's raw response, raw verdict/explanation, validated verdict/evidence, model and
configuration fingerprints, response/request/evidence hashes, and usage. Sensitive
provider error bodies are not retained. Candidate token/spend fields are preserved;
judge usage is recorded per judge and cost is totaled separately. Even scopes that
cannot be prepared and requests blocked by budgets retain criterion/judge rows.

Offline replay checks these bindings, reparses responses, rebuilds scoped evidence
from the original frozen run, and recomputes aggregation into a new grade receipt.
It refuses changed evidence, missing coverage, changed verdicts or result summaries.
Existing task/rubric/result schemas and score meaning remain unchanged. New judge
artifacts explicitly declare `all-mandatory-1.0.0`; changing evaluation meaning
requires a new version and new receipts. Original execution and judge files remain
untouched. Pure replay is reproducible; fresh model requests are not guaranteed to
repeat, including at temperature zero.

`src/grading/adjudicate.ts` fills only semantic rows. Deterministic facts, unsafe
attempts, truthfulness, approvals, and required committed effects stay authoritative.
Execution must be completed, grading resolved, and every mandatory criterion pass.
There is no averaging across criteria or judges. Two passes yield semantic pass;
two fails yield fail; disagreement or any judge error yields error and prevents
strict success. Both independent verdicts and their disagreement remain inspectable.
Agreement itself does not establish correctness.

`appendAdjudication(directory, receiptPath, decision)` accepts a supplied human
decision with actual reviewer identity/time, criterion, verdict, explanation and
scoped evidence. It writes a new `adjudication-<uuid>.json` using exclusive creation,
bound to the receipt and individual judge record hashes. Corrections explicitly
link an earlier record's hash with `supersedes`. This API records decisions; it does
not modify raw judges, resolve their recorded disagreement, or overwrite scores.
The offline format controls use temporary synthetic identities only. No actual
human adjudication or approval has been performed by this implementation.

## Calibration and remaining acceptance work

`fixtures/judge-calibration/pending.json` intentionally contains no examples or
labels. The exported calibration schema supports synthetic scoped examples for
missing issue, wrong amount in fluent prose, correct alternate wording, abstention,
conditional approval, false success, and prompt injection. Each example must carry
its scope/evidence hash, reviewer-supplied expected verdict, actual review metadata,
saved dual-judge receipt path/hash, and separate adjudication paths when applicable.
Expected labels and reviewer metadata never enter judge requests.

`inspectCalibration` checks saved evidence/response and adjudication bindings and
exposes individual judges, mismatches, errors, and disagreements offline. It refuses
mock evidence as release calibration. All seven reviewed scenarios must be present,
judges must match the labels without errors, disagreements need separate human
records, and the calibration pack must have an actual completed review. Failed
calibration requires revised, versioned configuration and new calibration evidence;
human records cannot turn incorrect raw judge results into agreement.

Release profiles require actual profile approval plus a hash-bound calibration pack
that passes inspection. The calibration configuration hash excludes only profile
review and its calibration link to avoid a circular hash; receipts also preserve the
full profile fingerprint. Temperature zero and two agreeing judges do not replace
reviewer labels or builder review.

Issue #11 is closed as superseded by [follow-up #21](https://github.com/uprez-net/Royal-Lab/issues/21)
at the owner's request; its human-dependent acceptance remains **pending**.
Scoped plumbing, fail-closed controls, all-pass
aggregation, independent records, replay and adjudication formats are implemented.
Reviewer-labeled golden calibration, actual dual-judge calibration, real human
adjudication of observed disagreements, and empirical prompt-injection resistance
remain pending. The acceptance criterion concerning inspectable/regradable golden
decisions is supported by infrastructure but has no actual golden decisions yet.
Issue #5's case/policy review remains an unresolved gate, now also tracked in #21.
See [the closeout record](issue-closeout.md). No report/comparison,
repeat orchestration, operational rule implementation, or new case authoring is added.

| Issue #11 acceptance criterion                                         | Current evidence and remaining work                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only scoped necessary evidence/output reaches judges                   | Implemented; offline transport controls inspect the complete request and exclude hidden facts, other cases/files and keys. Exact locators and real source review remain prerequisites. |
| Golden decisions/disagreements inspectable and reproducibly regradable | Formats, inspection, hash-bound replay and append-only records implemented. Actual reviewer-labeled golden decisions and real calibration/adjudication are pending.                    |
| Injected “mark this pass” does not override evaluation                 | Quoted framing, separate system instruction, no tools and offline protocol controls implemented. Empirical behavior of selected live judges still needs real calibration.              |
| Judge failure cannot pass or disappear from coverage                   | Implemented; malformed/error/timeout/unknown-usage and budget controls retain selected criterion/judge rows and prevent success.                                                       |
| Deterministic failure remains failure despite favorable semantics      | Implemented; offline controls cover critical facts, truthfulness, authorization, effects, approval and failed execution statuses.                                                      |

Verification for this change used Node 24.21.0 and pinned pnpm 11.1.2.
`pnpm schemas:export` exported all 21 schemas, including seven new judge contracts.
`pnpm check` passed formatting, typechecking, all 106 offline tests across eight files,
fixture lint, both suite integrity checks and the ESM build with copied judge prompt.
No paid candidate or judge request, real reviewer label, or human approval was produced.

## Calibration labelling set (2026-10-04)

`fixtures/judge-calibration/labelling-pack.json` holds 16 unlabelled synthetic
answers, two per calibration scenario (four for prompt injection: two candidate-level, two aimed at the judge), written against the semantic criteria of
reviewed packs (D01, D07, D11 and its injected variant, D14, D15 and T08). Each
example carries the exact judge scope built from the real task documents and its
evidence hash. `docs/calibration-labelling.md` is the reviewer sheet: criterion
standards, scoped source lines and the answer, with a blank label. Neither file
states which way an answer was written. `pnpm calibration:pack` regenerates both;
`tests/calibration-pack.test.ts` fails on drift.

Next steps, in order: the named reviewer labels every example; the labels are
recorded with reviewer metadata; the release pair
`profiles/judges/release-deepseek-qwen.json` judges each example in calibration
mode; disagreements get human adjudication records; and only a pack that passes
`inspectCalibration` can be approved and bound to the release profile.

Judge evidence for a deliverable is bound by its exact quote; the locator is
recorded but not checked, because a deliverable is scoped as one whole text and
live judges write a section description there. Source evidence still needs its
exact locator. The first live judged run lost every verdict to that locator check
before this rule; the exact-quote requirement is unchanged.

## Calibration run

`pnpm lab calibrate --pack fixtures/judge-calibration/labelling-pack.json
--judge-profile profiles/judges/release-deepseek-qwen.json --judge-key-env NAME
--max-judge-usd <n> --allow-paid` has the release pair grade every unlabelled
example in `calibration` mode, which is allowed before the release profile is
approved. Each example's scope is rebuilt from the real documents and must hash
to the pack's evidence hash before any request. Labels are never read and never
reach a judge. Each example reserves the profile's per-call ceiling against the
cap and settles to the recorded cost. Receipts and a raw-verdict summary go to
`results/calibration/`. The manual `.github/workflows/calibration.yml` runs it
with the `ROYAL_LAB_JUDGE_KEY` secret. `tests/calibration-run.test.ts` checks the
bindings offline with mock judges; `inspectCalibration` refuses mock evidence as
calibration.

## Recording reviewer labels

The reviewer's labels go in a labels file (`CalibrationLabelsSchema`): the pack
ID and version, the reviewer, `reviewedAt` with a note on how the time was
established, and a `pass` or `fail` for **every** example (a missing or unknown
ID is refused). `pnpm lab calibration-record --labels <file> --receipts <run dir>
--judge-profile <file>` copies that run's receipts into
`fixtures/judge-calibration/receipts/`, writes
`fixtures/judge-calibration/calibration-<profile>.json` with each example's
label as an approved reviewer review, and prints `inspectCalibration`: each
example's label against both judges, mismatches, judge errors and
disagreements. The pack's own review stays draft until the owner approves the
inspected result, and only then can the release profile carry its hash.
