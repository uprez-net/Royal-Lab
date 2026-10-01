# Prerequisites, setup and environment assumptions

Run commands from the Royal-Lab repository root. The examples work in PowerShell 7
or a POSIX shell unless a block is explicitly labeled for one shell.

## Choose a setup level

| Level               | Needed locally                                                                                       | What you can do                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Offline authoring   | Node 24 LTS, pnpm 11.1.2, installed lockfile dependencies                                            | TUI, inspect/validate draft packs, schemas, fixtures, offline tests and build |
| Binary readers      | Offline prerequisites plus Docker Engine/Desktop with Linux containers and Compose v2                | Local PDF/DOCX/XLSX extraction and parser integration controls                |
| Canonical bridge    | Docker, Git, private Royal-Construction access and the audited source pin                            | Synthetic PostgreSQL lead-task integration controls                           |
| Paid document trial | Reviewed case/world/policy/verifier packs, clean checkpoint, exact model/settings/key/pricing/budget | One explicitly opted-in candidate trial; current drafts remain blocked        |

Installation and image downloads require network access. Once dependencies are
installed, offline authoring checks make no candidate or judge API calls. Bridge
preparation may download Prisma engine artifacts. Runtime binary parser workers
have their own network disabled. A paid trial requires access to its explicitly
configured provider.

## Runtime and dependency assumptions

Use Node **24 LTS** (`.node-version` is `24`; package engines reject other majors)
and **pnpm 11.1.2** from `package.json`. The implementation has been checked with
Node 24.21.0 on Windows; offline CI runs Node 24 on Ubuntu. Do not rely on the
system's default Node version or update the dependency lockfile during setup.

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
```

Install Node 24 through your preferred installer/version manager. If pnpm is
missing, install the matching version with the selected Node:

```sh
npm install --global pnpm@11.1.2
```

Docker Desktop on Windows must use Linux containers; its engine must be running.
No host Python or host PostgreSQL installation is required. The parser image
contains Python/pypdf; Compose provides PostgreSQL. Product application servers,
Clerk, Xero, email, Blob and DocuSign credentials are unnecessary.

| Dependency group                   | Purpose                                                              | Where versions are fixed                                       |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| TypeScript, tsx and Node           | ESM source execution and compiled CLI                                | `package.json`, `pnpm-lock.yaml`, `.node-version`              |
| Zod                                | Strict runtime contracts and JSON Schema export                      | Pinned pnpm dependencies                                       |
| AI SDK and direct/gateway adapters | Common candidate tool loop and explicit provider transports          | Pinned pnpm dependencies; experiment fingerprints              |
| Ink and React                      | Interactive terminal workbench                                       | Pinned pnpm dependencies                                       |
| csv-parse and postal-mime          | Bounded CSV/email normalization                                      | Pinned pnpm dependencies and parser fingerprints               |
| Prisma, adapter-pg, pg and esbuild | Safe canonical command bundle and independent PostgreSQL observation | Pinned pnpm dependencies and bridge source-lock evidence       |
| Vitest and Prettier                | Offline/integration verification and formatting                      | Pinned development dependencies                                |
| Python and pypdf                   | Container-only binary extraction                                     | `sandbox/document-parser/Dockerfile`; immutable built image ID |
| PostgreSQL 17.9                    | Disposable synthetic state                                           | Digest-pinned image in `compose.yaml`                          |

All monetary facts use AUD cents unless a source contract explicitly distinguishes
another unit. Business date interpretation uses `Australia/Sydney` and the case's
frozen clock, including DST. The host timezone is not the business clock; the
independent verifier normalizes Prisma UTC timestamp columns explicitly.

## First offline check

```sh
pnpm lab --help
pnpm lab list --json
pnpm lab describe offers/reconcile-quote-build-up/cedar --visible --json
pnpm validate
pnpm fixtures:generate --check
pnpm schemas:export
git diff --exit-code -- schemas
pnpm check
pnpm tui
```

`pnpm check` covers formatting, strict TypeScript, offline Vitest tests, fixture
privacy/reference lint, both selected suites and the compiled build. It does not
require Docker or a private source checkout. Schema export and fixture drift
checks run separately in CI as shown above.

`pnpm lab validate --for-run` is expected to fail while packs are draft. Review
metadata must describe an actual human review; changing a flag to make the gate
green is not approval. Ordinary validation is useful and can pass for drafts.

The TUI needs an interactive terminal. Use arrows/j/k, Tab or left/right, Enter,
Escape and q. For automation use CLI JSON output; set `NO_COLOR=1` for uncolored
output. TUI actions remain offline.

## Build and verify binary readers

```sh
docker version
docker compose version
docker build -t royal-lab-parser:1.0.0 sandbox/document-parser
docker image inspect royal-lab-parser:1.0.0 --format '{{.Id}}'
pnpm test:integration -- integration/binary.test.ts
```

The inspect command returns `sha256:<64 hex characters>`. Copy the **local built
ID** into `binaryParser.imageId` in an ignored explicit config; use
`binaryParser.image: "royal-lab-parser:1.0.0"` as the descriptive label. An image
tag alone is insufficient. Optional `timeoutMs` must be positive and at most 60000. Docker CLI, daemon and that image must be available to the process doing
extraction. Rebuilding an image changes the parser fingerprint and requires
deliberate extract/review updates.

Current specimens contain text inputs, so binary-reader setup is optional for
their offline validation. OCR, automatic spreadsheet recalculation and extraction
of email attachment contents are unsupported; gaps remain visible for review.
See [reader boundaries](document-workspace.md).

## Prepare the private canonical bridge

Git authentication must permit read access to Royal-Construction. Create a
separate ignored checkout; the product application is never installed or changed.
For a fresh workspace:

```sh
git clone --no-checkout https://github.com/uprez-net/Royal-Construction.git .guri
git -C .guri checkout --detach 460895235f94e917bd855855cd6e106f93a4c7c1
git -C .guri status --short
docker compose up -d --wait
pnpm lab bridge prepare --config config/bridge.example.json
pnpm lab bridge check --config config/bridge.example.json
```

If `.guri` already exists, inspect its revision/cleanliness rather than cloning
over it. The supported revision is the exact detached pin above. Product changes
are not a benchmark setup step. `bridge prepare` writes generated Prisma client,
schema SQL and bundled canonical leaves under ignored `.cache/guri/`; it checks
source cleanliness, versions and import safety. `bridge check` verifies the source
and runtime hashes without running a model or generating a score.

Compose publishes PostgreSQL only at `127.0.0.1:55432`, with control database
`royal_lab_control`, user `royal_lab` and the committed disposable development
password. The initialization SQL marks the cluster synthetic-only. The explicit
example config targets this cluster; it does not load `DATABASE_URL`.

Each operational control creates its own `royal_lab_run_<uuid>` database, seeds
original fictional entities, observes state independently and drops its owned
database on cleanup. The controller requires the local control URL and marker.
This setup must not be substituted with production or shared staging. Compose
stores data in tmpfs: stopping/recreating the container loses the synthetic data.

After both parser and bridge preparation, run the full local integration lane:

```sh
pnpm test:integration
docker compose ps
```

These tests cover real parsing and canonical PostgreSQL effects, with offline mock
candidate HTTP. They make no paid candidate/judge request and do not establish live
model compatibility. The current tools are lead lookup/list/create; all broader
operations are explicitly unsupported. See [bridge semantics](guri-bridge.md).

When finished, stop the disposable cluster with `docker compose down`. This
removes its synthetic tmpfs data; saved evidence under `results/` is separate.

## Configure an eventual paid trial

First obtain the [configuration inputs](configuration.md): actual named review,
policy amendments, exact direct/gateway model IDs and supported parameters,
current route-specific pricing, local credentials and explicit budgets. Do not
paste secrets into chat, issues or tracked files.

Store a config under ignored `tmp/`. It must set `profile: "documents"`,
`repeats: 1`, `concurrency: 1`, a run spend cap, and a `candidate` with provider
`"direct"` or `"gateway"`, exact `model`, `parameters`, `apiKeyEnv` and `pricing`.
Pricing requires a semantic version, ISO timestamp and actual input/output USD
rates per million tokens; cached input pricing is explicit when applicable. A
placeholder model or zero rate is not a verified model configuration.

The optional `limits` object has `maxTurns`, `maxToolCalls`, `maxInputTokens`,
`maxOutputTokens`, `maxDurationMs` and `maxCostUsd`. Defaults are provisional:
30 turns, 60 calls, 200000 input tokens, 12000 output tokens, 300000 ms and $2.
The default repeat/concurrency settings are intended for later orchestration and
are rejected by the present single-trial CLI unless explicitly set to 1.
Effective case limits can only narrow frozen limits; the spend cap also narrows
the cost limit. Defaults never authorize paid execution.

Set only the explicitly named key in the invoking process. This PowerShell
example avoids embedding the secret in command history:

```powershell
$candidateCredential = Read-Host 'Candidate API key' -MaskInput
$env:ROYAL_LAB_CANDIDATE_API_KEY = $candidateCredential
Remove-Variable candidateCredential
```

Use `apiKeyEnv: "ROYAL_LAB_CANDIDATE_API_KEY"` to refer to it. `.env` and
`.env.example` are never automatically loaded. Bridge checkout/database settings
are JSON fields, not ambient environment overrides. A future judge credential
does not enable a semantic judge today.

```sh
pnpm lab config show --config tmp/candidate.json
pnpm lab validate --suite suites/development.json --for-run
pnpm lab run offers/reconcile-quote-build-up/cedar --suite suites/development.json --verification grading/verification.json --config tmp/candidate.json --allow-paid
pnpm lab grade <saved-run-id>
```

`grading/verification.json` is relative to the selected case and must match its
frozen declaration. Run from a clean committed checkpoint. Current draft packs
deliberately block the run command before credentials/provider execution.
The `grade` command reads saved evidence and appends a grading receipt without
candidate API calls; it cannot manufacture missing semantic judgments.

## Development and CI

`pnpm build` compiles ESM and copies prompt assets. Run `node dist/cli.js list
--json` from the repository root. Native `#...` imports resolve source under the
development condition and compiled files otherwise; supplied scripts and Vitest
already select the appropriate condition. No custom alias rewrite is needed.

Use `pnpm format` for authored files and `pnpm format:check` to verify. Generated
fixture packs and schemas keep exporter-owned bytes/hashes and are excluded from
Prettier. Export schemas after contract changes; run `pnpm check` and explicit
schema/fixture drift checks before a checkpoint commit.

Offline CI uses `actions/checkout@v7.0.1`, `pnpm/action-setup@v6.1.0` and
`actions/setup-node@v7.0.0`. Their official action definitions declare `node24`:
[checkout](https://github.com/actions/checkout/blob/v7.0.1/action.yml),
[pnpm setup](https://github.com/pnpm/action-setup/blob/v6.1.0/action.yml),
[Node setup](https://github.com/actions/setup-node/blob/v7.0.0/action.yml).
The action runtime is distinct from the project's selected `node-version: 24`.
The workflow requires no model secrets or private product checkout and performs
only offline checks. A self-hosted runner must support the actions' Node 24 runtime.

## Common setup failures

| Symptom                                              | Meaning and next step                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Node engine rejection                                | Select Node 24, reopen the shell and verify `node --version`                                                  |
| Frozen install fails                                 | Check registry access and use the committed lockfile; do not regenerate it as a workaround                    |
| TUI refuses piped input                              | Use an interactive terminal or the `--json` CLI commands                                                      |
| `--for-run` reports pending reviews                  | Obtain actual case/world/policy/verifier review; ordinary offline validation may still pass                   |
| Docker daemon unavailable                            | Start Docker Engine/Desktop and verify Linux containers with `docker version`                                 |
| Parser image missing or ID mismatch                  | Build/inspect the image locally and configure its immutable ID                                                |
| Port 55432 occupied                                  | Identify the existing listener; use the prepared isolated cluster rather than another project's database      |
| Synthetic control marker missing                     | Start the supplied Compose cluster and initialization SQL; do not bypass the marker                           |
| `GURI_REVISION` or `GURI_DIRTY`                      | Restore a separate clean audited checkout; do not change product files for the benchmark                      |
| Missing `.cache/guri/schema.sql`                     | Run bridge preparation before canonical integration tests                                                     |
| `SINGLE_TRIAL_ONLY`                                  | Explicitly configure repeats and concurrency as 1                                                             |
| `RUNNER_DIRTY`                                       | Commit deliberate implementation/dataset changes before paid execution                                        |
| `CANDIDATE_CONFIG_MISSING` or unsupported parameters | Supply exact provider/model/pricing and settings that the selected adapter supports                           |
| `USAGE_UNVERIFIED`                                   | Provider accounting is missing; inspect preserved trace, treat cost as unknown and stop further paid requests |
| Evidence/hash drift on grading                       | Preserve and investigate saved evidence; regrading refuses changed execution inputs                           |

`tmp/`, `.cache/`, `.guri/`, `dist/`, `node_modules/` and `results/` are ignored.
The source, synthetic fixture packs, schemas and lockfile are tracked. Results
remain private even though they are ignored; keep trusted evidence intact for
regrading and review. There is no automatic result backup or publication service.
