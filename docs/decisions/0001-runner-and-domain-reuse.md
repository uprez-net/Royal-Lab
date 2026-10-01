# ADR 0001 — Standalone Node runner, portable contracts and policy authority

Status: accepted for implementation, 2026-10-01.

Use Node 24 LTS, TypeScript ESM, pnpm and Zod with exported JSON Schemas. Use
Vitest/node:assert for offline checks and Ink/React for the requested terminal UI.
Use native # subpath imports with source/compiled conditions rather than @ aliases
that would need runtime rewriting. Exact packages are pinned in the lockfile.

Royal-Construction's canonical domain commands accept principal/input/db/ports;
the later private bridge can reuse them without copying Next/Eve app dependencies.
Documents remain independent of that checkout, Clerk and PostgreSQL. Candidate
providers are adapters (#8), not an execution framework imposed on task contracts.
Intended business policy overrides product behavior across all profiles. Record
unsupported behavior rather than implement competing operational rules locally.

Harvey offers useful case-pack/harness/grader separation and all-pass rubrics.
Its Python harness, shell/Podman workspace and semantic-only graders are not our
required architecture. Inspect is a credible Python option with agents, tools,
sandboxes and custom scorers; DeepEval offers Pytest-style evaluation and tracing.
Node is chosen for typed domain integration and one primary runtime, **not** an
unmeasured performance claim. Python can later serve isolated parsers or research
analysis through the same JSON contracts. No code from these harnesses is vendored.

Consequences: maintain the small measurement-specific layer and operational
verification; avoid building a general framework. An AI SDK provider adapter may
use the pinned SDK behind our common interface when #8 lands. Its own default loop,
fallbacks or model upgrades must not silently change a controlled experiment.

References: [domain guide](https://github.com/uprez-net/Royal-Construction/blob/460895235f94e917bd855855cd6e106f93a4c7c1/lib/domain/GUIDE.md),
[Harvey architecture](https://github.com/harveyai/harvey-labs/blob/f93ae2ac2831e65892fea83094cfb50149bc2e59/docs/architecture.md),
[Inspect](https://inspect.aisi.org.uk/), [DeepEval](https://deepeval.com/docs/getting-started),
[Node imports](https://nodejs.org/docs/latest-v24.x/api/packages.html#subpath-imports),
[Ink](https://github.com/vadimdemedes/ink).
