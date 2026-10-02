# Private canonical domain bridge

The bridge imports Node-safe leaf modules from the clean private checkout at
`460895235f94e917bd855855cd6e106f93a4c7c1`. It changes no product files. A local
ignored cache contains the generated Prisma 7.10 client/schema SQL and a bundle
of canonical commands. The build resolves product aliases, rejects forbidden
Next/Clerk/model/provider imports and records source, lockfile, schema and bundle
hashes. Commands receive an explicit database and canonical principal/access checks.

The minimum bridge exposes the lead tools and scoped offer/project/compliance/
tradie/admin adapters for T03–T12. See [operational controls](operational-controls.md)
for exact tool limits, canonical ownership, recording ports and stale-version
execution. Other operations return an explicit unsupported capability.
This is not a claim that all 57 product tools or authored release cases are runnable.
Business-policy disagreements remain unsupported until reviewed.

Each run uses a unique `royal_lab_run_<uuid>` database in the disposable Compose
cluster. A synthetic control marker is required before creation. Seeds contain
only fictional entities. Reset/cleanup drops only the database generated for that
run, including after failure. The controller ignores ambient database URLs.
PostgreSQL is published only on localhost; use the Compose cluster, not production
or shared staging. Its development-only password does not authorize any other DB.

Canonical task creation and the Royal-Lab call journal share one PostgreSQL
transaction. Approval binds owner, session, call, tool and exact arguments. A
transaction-scoped lock protects same-call replay; changed arguments conflict and
a new intentional action gets a new call. Canonical business history remains
separate from fixture initialization and the experiment journal. This is not
Eve's AgentOperation/AgentActionAudit implementation. SQLite experiment journals
for other effects retain uncertain operations and require reconciliation rather
than blindly retrying them.

A second connection observes durable rows/history/journal after commit. Tool
success alone is insufficient. The command process freezes the supplied task
clock for domain helpers; PostgreSQL system timestamps remain infrastructure
timestamps. External service clients are absent. Recording ports support
success/fault/cancel/replay evidence; unavailable effects return unsupported.

```sh
git clone --no-checkout https://github.com/uprez-net/Royal-Construction.git .guri
git -C .guri checkout --detach 460895235f94e917bd855855cd6e106f93a4c7c1
docker compose up -d --wait
```

Prepare the bridge with `pnpm lab bridge prepare --config config/bridge.example.json`,
verify it with `bridge check` using the same config, then run `pnpm test:integration`.
Never commit `.guri`, generated runtime caches or personal
connection settings. No application dependency installation or deployment is needed.

Bridge/runtime and independent state artifacts are version 2.0.0. Reprepare old
caches explicitly; saved score/result artifacts are never migrated.

The fixed-tools harness composes the closed document workspace, deterministic
operator and canonical bridge. Questions and supplied facts, requested/approved/
cancelled decisions, responder/session identity, executions and durable-operation
evidence are traced separately. API integration controls prove approval creates one
task, cancellation creates none and same-call bridge replay creates no duplicate.
There is no authored release-ready fixed-tools case yet; the CLI trial command
currently executes document cases. The expanded script/case review remains pending
in issue #21. The prepared source checkout remains unchanged.
