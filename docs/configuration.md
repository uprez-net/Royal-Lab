# Configuration inputs

Start with [setup and environment assumptions](getting-started.md) and
[architecture](architecture.md). This page lists the owner decisions needed to
configure execution; offline authoring does not need candidate credentials.

Node 24 LTS and pnpm 11.1.2 are sufficient for offline authoring, integrity checks,
schemas, TUI and tests. The TUI performs offline checks. Code, data and results remain
private; no release or external business outreach is configured.

The local pinned checkout `.guri/` and disposable Compose PostgreSQL setup are
prepared. Their caches and credentials are ignored by Git. The verified operational
surface includes lead tools and minimum T03–T12 adapters with explicit provider
boundaries. See [operational controls](operational-controls.md). Release cases and
expanded scripts remain subject to real review.

Before a paid candidate trial, supply these decisions:

1. **Reviewer and actual review:** a named NSW residential builder business or its
   designated reviewer, approval/amendments to [the review pack](review-pack.md),
   and review of its four hidden verification plans. Other builder businesses are eligible.
2. **Candidate configurations:** direct OpenAI API or AI Gateway route, exact model
   IDs to compare, and supported temperature/top-p/seed/reasoning settings. Neither
   route nor a current model is selected automatically. Live provider compatibility
   and baseline behavior have not been measured; protocol controls used mock HTTP.
3. **Local credentials:** set an explicit API key or the explicitly named `apiKeyEnv`
   in an ignored config file. Do not put keys in chat, issues or committed files.
4. **Pricing and budgets:** versioned pricing timestamp and input/output/cache rates
   for the selected route/model; candidate token/turn/tool/time/cost caps and overall
   spend cap. A case's effective limits can only narrow its frozen limits. The current
   CLI runs one trial: set `repeats: 1` and `concurrency: 1`. Suite orchestration is #16.
5. **Policy amendments:** markup/rounding/approval/negotiation/evidence assumptions
   specific to a builder, if any. Intended policy overrides product behavior. Resolve
   documented disagreements before enabling affected operations. Use synthetic examples.

Judge models, separate judge budgets and real calibration reviewers are needed for
opt-in [semantic grading](semantic-grading.md); default deterministic regrading and
saved judge replay remain offline. Royal Eve deployment/session metadata
belongs to #18. No production database, Clerk, Xero, email, Blob or DocuSign credential is needed.

## Local configuration

`pnpm lab config show --config <file>` validates and redacts secrets. Unknown fields
are rejected. No `.env` file, ambient `DATABASE_URL`, or another checkout's environment
is loaded. Store config under ignored `tmp/`. Only the explicitly named credential
environment variable is read, after run preflight and input preparation.

For bridge setup use `config/bridge.example.json`, then:

```sh
docker compose up -d --wait
pnpm lab bridge prepare --config config/bridge.example.json
pnpm lab bridge check --config config/bridge.example.json
pnpm test:integration
```

For documents, create an ignored config with `profile: "documents"`, single-trial
settings, candidate `provider`, `model`, `parameters`, `apiKeyEnv` and `pricing`.
Pricing includes a semantic `version` such as `1.0.0`, an ISO `asOf`, and actual
`inputUsdPerMillion`/`outputUsdPerMillion`; optional cache rates must be explicit.
No placeholder price is treated as a verified free model.

```sh
pnpm lab run offers/reconcile-quote-build-up/estuary --suite suites/held-out.json --verification grading/verification.json --config tmp/candidate.json --allow-paid
pnpm lab grade <saved-run-id>
```

The current draft packs deliberately block that run command. Every selected case
is retained in its saved preflight record. After approval, a single trial manifest
marks other suite cases explicitly excluded; it is not a full-suite result.
Regrading appends a new receipt and keeps execution evidence intact. Missing semantic
judgments or verifier evidence remain ungraded/error and cannot yield strict success.

## Binary parser

Build `royal-lab-parser:1.0.0` using `sandbox/document-parser/Dockerfile`. Inspect the
built image's immutable ID and set `binaryParser.image`, `imageId` and optional
`timeoutMs` in local config. The worker runs by image ID with network, host mounts,
privileges and write access disabled. See [reader setup](document-workspace.md).
The specimens and current authored packs supply normalized text; OCR is unsupported.
