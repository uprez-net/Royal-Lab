# Contract and integrity guide

`src/contracts` defines strict runtime contracts. `schemas/` exports Draft 2020-12
JSON Schema for task, suite, profile, rubric, trace, result, manifest, world, fixture
and provenance. A field-shape validator is not enough: Royal-Lab preflight enforces
cross-file references, source/hidden hashes, profile/tool compatibility, task IDs
matching directories, nonempty mandatory rubrics, document deliverable references,
source evidence, world clock/split and development/held-out isolation.

Portable paths forbid traversal, absolute paths, backslashes, drive/ADS colons,
percent encodings, control characters and Windows device names. Scoped reads reject
symlink/junction paths and require realpath containment. A future candidate workspace
must still mount only visible files and run binary readers in an OS isolation boundary.

Task/schema/scenario/rubric/fixture/profile versions are distinct. Human review has
draft/approved/rejected state, a named reviewer and timestamp for a completed review.
The fixture generator never supplies approval. Ordinary validate checks authoring
integrity; --for-run additionally requires review and implemented execution.

Each criterion is deterministic or semantic with severity, mandatory flag, category,
scoped deliverables and evidence facts/locators. Exact expected JSON, relational state
and effect-count assertions are hidden. Critical criteria must be mandatory. State
and effect assertions are valid for tool profiles; document cases use artifact checks.

Trace JSONL captures candidate responses, attempted/executed tools, approvals,
scripted input and committed-effect evidence. Artifact validation checks contiguous
sequences and consistent run/task identities, requires attempts before executions
and executions before commit events. A future verifier must additionally correlate
approval bindings, transaction/audit evidence and recording ports independently.

Result shape records execution separately from grading, mandatory criterion verdicts,
critical gates, permitted outcome, usage and hashed artifacts. strictSuccess is
validated against execution and all mandatory criteria. Judge errors are not passes.
Run manifests contain fingerprints, candidate/judge settings, pricing snapshot,
limits/repeats and every selected case/trial. Missing trials and duplicate rows are
invalid. `src/runs/accounting.ts` retains missing-result rows and suppresses a
comparable success rate for incomplete experiments. This is accounting infrastructure,
not a grader or report implementation.

Saved artifacts can be independently validated through `validate --artifact ...
--kind result|trace|manifest`. Schema validation cannot prove artifact existence or
state persistence; later run/grade/report components must verify content hashes and
cross-artifact identity/evidence against the frozen manifest and rubric.
