# Execution and deterministic verification

`runCandidate` uses the pinned AI SDK ToolLoopAgent with direct OpenAI and AI
Gateway adapters. Both routes ran the same task through offline mock HTTP controls.
This proves transport/tool/artifact plumbing, not live model quality or compatibility.
Provider clients are lazy and credentials are explicit. Both the CLI and low-level
harness require explicit paid opt-in. Offline controls require a supplied mock transport
and record their execution mode. No paid request has been made.

Mutations, operator decisions and tool dispatch run serially. Raw provider request/
response metadata, candidate text, malformed/unknown attempts, executed calls and
termination are retained. Retries are disabled. SDK notification callbacks do not
enforce stop decisions: the prepare-step boundary and tool dispatcher do. Unsupported
parameter warnings are errors; unknown usage stays null and blocks the next request.
Actual usage is checked after responses. Output requests and worst-case declared token
cost reservations are bounded before a request; provider token accounting remains
authoritative. There is no claim that provider-side failures or hidden gateway routing
produce exact local token estimates. Frozen pricing defines the reported estimate.

The CLI executes one reviewed document trial with explicit `--allow-paid`, narrower
effective limits, a spend cap and a clean checkpoint. Full-suite preflight runs first,
including frozen verification hashes and real review metadata. All selected cases
remain in saved preflight/manifest coverage. Other cases are explicitly excluded by
single-trial selection; repeated/concurrent suite orchestration is #16.

Saved configuration hashes include prompt, schemas, limits, provider settings, SDK,
pricing, raw/parser/extract fingerprints and runner/dependency versions. Prompt,
normalized documents, grading inputs, execution result, trace and artifact hashes
are retained. The execution receipt detects changed result/trace/config/documents;
regrading verifies these and writes a new grade file without importing a candidate
client or making a candidate request. Original execution evidence is kept.

The typed hidden verification plan supplements rubric facts with scoped prose,
exact target/state/history/journal preservation, recording-port outcomes, safe
attempt/approval checks and normalized citations. Monetary values use integer AUD
cents; date-only, equivalent instant and Sydney date comparisons are distinct.
Prose matching is deliberately scoped to reviewed labels and parseable monetary,
count/date/identifier/claim forms. General prose meaning uses the opt-in
[scoped semantic path](semantic-grading.md); an unclear
required prose fact is error/unverified. Use separately scoped sentences for multiple
amounts. A deterministic pass cannot stand in for semantic review.

State grading requires an independent PostgreSQL connection, not a command's
success text or fake Prisma. Experiment journal, fixture initialization, canonical
history and recording-port evidence are separate. Failed critical facts, approval
bypasses and blocked unsafe attempts cannot yield strict success. Missing verifier
evidence stays error; semantic criteria require valid scoped judgments and prevent
final success when ungraded or error.

The authoring-only pricing oracle bundles canonical pure helpers from the clean
private pin, executes original numeric inputs, and records helper/source/input/output
hashes. It never marks its output reviewed. Only output numbers and provenance may
be frozen as fixture data; a benchmark release requires independent business review.
No product templates or operational rule implementation is committed.

Task schema/version 1.1.0 adds mandatory frozen verifier references. Trace/result
1.1.0 distinguish new request/response/question/termination events and unknown usage;
1.0.0 results still require known token counts. The four original draft tasks were
explicitly upgraded without changing policy/source bytes. Comparisons must preserve
these versions and fingerprints; no score migration or calibrated baseline exists.

The fixed-tools API covers lead lookup/list/create, minimum T03–T12 adapters and deterministic
clarification/approval/cancel/replay. Real integration controls verify one approved
write, no cancelled write, independent history/journal and durable same-call replay.
Executable requirements stale-version injection, refresh and newly approved arguments
are verified against canonical commands. See [operational controls](operational-controls.md).
Full operational case authoring/review and Eve deployment semantics remain pending. Existing journal
controls keep new intentions distinct and uncertain effects unretried.
