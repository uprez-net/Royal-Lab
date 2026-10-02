# Contract and integrity guide

`src/contracts` defines strict runtime contracts. `schemas/` exports Draft 2020-12
JSON Schema for task, suite, profile, rubric, trace, result, manifest, world, fixture
and provenance, plus normalized document, interaction, verification and oracle artifacts.
A field-shape validator is not enough: Royal-Lab preflight enforces
cross-file references, source/hidden hashes, profile/tool compatibility, task IDs
matching directories, nonempty mandatory rubrics, document deliverable references,
source evidence, world clock/split and development/held-out isolation.

Portable paths forbid traversal, absolute paths, backslashes, drive/ADS colons,
percent encodings, control characters and Windows device names. Scoped reads reject
symlink/junction paths and require realpath containment. The closed candidate workspace
projects only declared inputs; binary readers run in a constrained Docker worker.

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
and executions before commit events. The deterministic verifier additionally correlates
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
state persistence; run/grade verify saved content hashes and
cross-artifact identity/evidence against the frozen manifest and rubric.

Task schema 1.1.0 requires a hidden verification path/hash, with approved verification
metadata for run preflight. New trace event types require 1.1.0; unknown token counts
are supported only in result 1.1.0. The four draft tasks explicitly moved to task
version 1.1.0; policy/source bytes remained unchanged. See [execution](execution.md)
for the current grading boundaries and retained evidence.

Issue #11 adds separate version 1.0.0 judge-profile, scope, response, record,
semantic-receipt, human-adjudication and calibration contracts and exported schemas.
Existing result/rubric shapes and all-mandatory scoring are preserved. See
[semantic grading](semantic-grading.md) for scoping, replay and pending real review.

Issue #21 adds version 1.0.0 bridge-controls, recording-port-policy and
stale-version-control formats, and version 2.0.0 canonical snapshot/state evidence
and fixture-initialization formats. Durable recording receipts explicitly carry
`simulation: true`. All seven new contracts have exported JSON Schemas. Old
result/rubric/score meaning remains unchanged; old saved evidence is not rewritten.
See [operational controls](operational-controls.md).
