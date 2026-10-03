# Royal-Lab

Private benchmark for NSW residential builder office work: evidence-backed
commercial analysis, decisions, document understanding and approved operations.
Designed for any residential builder using an explicit, versioned business policy.

The roadmap has **28 definitions** (16 document/analytical, 12 operational).
The [draft case library](docs/authored-cases.md) now has **49 packs**: 28 authored
core cases for D01–D16/T01–T12, seven document variants, ten tool diagnostics and
four preserved specimens. Two independent fictional worlds keep
development and held-out evidence separate. Closed readers, two candidate
transports, deterministic graders, scoped semantic judging and minimum canonical
T01–T12 adapters are implemented. Human business review, actual judge calibration
and paid baseline runs remain pending; there are no model scores. The D13–D16
analytics cases (#20) use visible policy 1.2.0.

## Start

Read the [documentation guide](docs/README.md),
[setup and prerequisites](docs/getting-started.md) and
[architecture](docs/architecture.md) for the case lifecycle, environment assumptions,
dependencies, trust boundaries and current execution limits.

Use Node 24 LTS and pnpm 11.1.2.

```sh
pnpm install --frozen-lockfile
pnpm tui
```

The Ink workbench supports arrows or j/k, Tab or left/right to change sections,
Enter to inspect/check, Escape to go back and q to quit. It adapts to terminal width,
uses the alternate screen, and performs only offline authoring operations.
Piped/CI commands use the CLI below. Set NO_COLOR=1 for uncolored output.

```sh
pnpm lab --help
pnpm run list
pnpm describe offers/reconcile-quote-build-up/cedar
pnpm describe offers/reconcile-quote-build-up/cedar --visible --json
pnpm validate
pnpm fixtures:lint
pnpm fixtures:generate --check
pnpm lab controls
pnpm check
```

The first document case contains a fictional source pack and visible policy,
requests facts.json and review.md, and keeps its fixture/rubric/provenance separate.
`--visible` constructs a new allowlisted projection; it never emits hidden grading
or repository configuration. `validate` checks every selected case before reporting.
`validate --for-run` currently exits nonzero because human review is pending.
`run` requires an explicit paid-execution flag and approved source/world/verifier
packs; `grade` rechecks frozen saved evidence without candidate calls. Semantic
criteria require explicit opt-in judges or preserved judge-response replay;
real calibration remains pending. Reserved report/compare commands exit 3.

```sh
pnpm schemas:export
pnpm lab validate --artifact results/example/result.json --kind result
pnpm lab validate --artifact results/example/trace.jsonl --kind trace
pnpm lab validate --artifact results/example/manifest.json --kind manifest
pnpm build
node dist/cli.js list --json
```

Generated fixtures are already committed. Generation creates missing canonical
files and refuses to overwrite edited ones. Bump versions/review deliberately;
the check mode detects drift. No production identities, templates or transcripts
are inputs to the generator. Human approval is intentionally not generated.

## Formatting

`pnpm format` formats authored TypeScript, TSX, JSON, Markdown and YAML;
`pnpm format:check` verifies them without edits and runs as part of `pnpm check`
and CI. Prettier is pinned in the lockfile. EditorConfig and Git enforce LF line
endings, including on Windows. VS Code recommends the Prettier extension and
formats on save using this repository's configuration.

Canonical generated schemas and fixture/task/suite packs are excluded from
Prettier: their exporters own the exact bytes and frozen hashes. Check them with
`pnpm fixtures:generate --check` and schema export/drift checks instead.

## Architecture and imports

Native package imports (`#contracts/task`, `#tasks/validate`, `#fixtures/world`,
`#runs/accounting`, `#src/config`, `#tui`) resolve source under the development
condition and compiled JavaScript in production. No runtime alias rewriting is
needed. The supplied source scripts set the development condition; compiled scripts
omit it. Vitest/TypeScript resolve the same development mapping.

See [benchmark specification](docs/benchmark-spec.md), [source audit](docs/audit.md),
[case capability matrix](docs/capability-matrix.csv), [57-tool inventory](docs/tool-capability-matrix.csv),
[task authoring](docs/task-authoring.md), [contracts](docs/contracts.md),
the [draft case library](docs/authored-cases.md),
the [business review pack](docs/review-pack.md), and [configuration inputs](docs/configuration.md).

Business policy outranks product behavior. A bridge limitation or disagreement is
recorded explicitly; no competing product rule is copied into Royal-Lab.
Everything remains private/proprietary. Nothing here authorizes a public release.
