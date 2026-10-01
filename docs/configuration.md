# Configuration inputs

## Foundation: usable now without credentials

Node 24 LTS and pnpm 11.1.2 are sufficient for list/describe/validate, fixture
generation/linting, schemas, tests and TUI. There is no database, Clerk, Vercel,
email/Xero/DocuSign credential or provider key required at this stage.

The user has selected 28 task definitions, intended business policy as authority,
NSW residential construction for any builder, and private code/dataset/results.
The remaining non-secret review input is a **named business reviewer** and approval
of the concrete policy/case packs. Drafts stay visibly draft until that review occurs.

## When candidate execution (#8) is implemented, supply

1. Candidate provider route (direct API, gateway, or later local compatible server).
2. Exact model IDs to compare, reasoning/sampling settings, context/output limits.
3. Provider API credentials, configured locally; do not put them in an issue or chat.
4. Maximum spend for the entire experiment, candidate and judge caps separately,
   trial count and desired concurrency. Current defaults are provisional.
5. Judge provider/models and reviewer for calibration/disagreements.
6. Any builder-specific policy amendments: markup/margin floors, approval limits,
   negotiation constraints, evidence precedence and cash-flow assumptions. Use
   synthetic examples; no production customer material is needed.

## When fixed-tool execution (#7/#9) is implemented, supply

1. Approved pinned private Guri checkout/path and the permitted operation subset.
2. A disposable **synthetic-only** PostgreSQL connection and reset strategy.
3. Recording-port configuration; real recipients, invoices and envelopes are unused.
4. Owner/principal fixture identities and approved interaction scripts.
5. Resolution of each business-policy/product-behavior discrepancy in the matrix.

## Optional Eve profile (#18)

Supply an explicit staging URL, evaluator identity, allowed target, authenticated
session access, deployed revision/model/prompt/budget metadata and independent
verification access. External-effect cases remain cancel-only on staging.

## Explicit configuration

`pnpm lab config show --config <file>` validates and displays effective configuration
with apiKey/token/secret/password/credential/database URL fields redacted. Omit the
file for offline defaults. Unknown fields are rejected. No .env file, ambient
DATABASE_URL or another project's configuration is automatically loaded.

Store local configuration under an ignored directory such as `tmp/`. The future
adapters will document explicit credential injection; .env.example is only a list
of reserved names, not a secretly active loader. Run manifests record redacted
effective configuration and version fingerprints, never secrets.
