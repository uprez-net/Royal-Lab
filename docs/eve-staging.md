# Royal Eve staging profile (#18)

The Royal Eve profile reuses a small Royal-Lab scenario subset to evaluate Guri's
**composed, deployed agent**: the orchestrator, its specialists, its prompts and
its product-pinned model. A Royal Eve score belongs to that deployment. It is
never a candidate-model ranking and is never pooled with the Documents or Fixed
tools profiles ([reporting](reporting.md)).

| Path                                      | Responsibility                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/harness/adapters/royal-eve.ts`       | Target allow-list, preview bootstrap, token refresh/revoke, same-session continuation |
| `src/harness/adapters/eve-events.ts`      | Recursive NDJSON session normalization across delegated specialist sessions           |
| `src/environments/eve/preflight.ts`       | Offline target/pin/credential/database/case checks before any request                 |
| `src/environments/eve/verifier-import.ts` | Strict import of the separate fixture maintainer's `verify` report                    |
| `src/environments/eve/grade.ts`           | Deterministic Royal Eve gates                                                         |
| `profiles/royal-eve.json`                 | Deployment pins, supported cases, exclusions and never-approve list                   |

## Transport and identity

The profile uses the existing `/eve/v1/session` flow and the product's
preview-only evaluator bootstrap:

1. `POST /api/eval/auth` with the shared secret. The response must say
   `environment: "preview"` and carry a token that lives at most 300 s. The
   operations agent and specialists flags must be on, and the database label,
   fixture version and deployment host must equal the profile pins.
2. `GET /eve/v1/info` must report `eve-agent-info` at the pinned info version.
3. `POST /eve/v1/session` with the first message. Clarifications and approvals
   continue the **same session** (`POST /eve/v1/session/:id` with `message` or
   `inputResponses`).
4. On exit, `POST /api/eval/auth/revoke` revokes the session.

Tokens are refreshed (re-bootstrapped, with the old session revoked) once fewer
than `refreshMarginSeconds` remain. A 401/403 on a session route is an
**infrastructure** outcome (`credential-expired`), never a candidate failure or
success.

The MCP channel publishes Eve's four invocation lifecycle tools for the same
agent, not raw business tools. Using it would need a separately declared
transport profile, so it is `not-enabled`.

## Two machines, three roles

| Role                | Holds                                        | Does                                                                 |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| Staging deployment  | Clerk secret, eval user, shared secret       | Mints a five-minute token for the dedicated eval user                |
| Royal-Lab evaluator | Shared secret (by variable name), target URL | Bootstraps, drives sessions, observes streams, grades                |
| Fixture maintainer  | Staging database credential only             | Runs `pnpm eve:eval:fixtures verify` and `reset` in the product repo |

Preflight refuses an evaluator config that has a database URL, Clerk or bearer
key. It also refuses an environment that holds `EVE_EVAL_AUTH_TOKEN` (the
product's direct bearer override), `EVE_EVAL_FIXTURE_DATABASE_URL` or
`CLERK_SECRET_KEY`. There is no bypass bearer path in the benchmark command.

## Preflight

`pnpm lab eve preflight --eve-config <file>` makes no request. It requires:

- an HTTPS target with no embedded credentials;
- a `*.vercel.app` preview, or exactly the named staging host;
- a target with no production-looking name;
- pinned agent commit, deployment host, prompts hash and tool catalogue hash;
- the named bootstrap secret variable;
- the selected cases in the supported subset, with their fixture label variables set.

Live bootstrap facts are checked again before any session is created. A refused
target produces a `blocked-input` record with no session.

`templates/eve-config.example.json` shows the evaluator config. Deployment pins
go in its `deploymentPins` overlay and stay private.

## Supported subset and exclusions

| Case                           | Based on | Kind               | Gate summary                                                                                          |
| ------------------------------ | -------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `eve-lead-tasks-read`          | T02      | read               | `list_lead_tasks` completed inside a specialist session; nothing approved; children finished          |
| `eve-lead-task-approved-write` | T02      | approved write     | Same-session approval naming the run marker; exactly one completed call; independent durable evidence |
| `eve-outreach-cancelled`       | T08      | cancelled external | Proposal cancelled; outreach never executed in any session; reply makes no completion claim           |

Every live case lists its input-profile differences, such as staging fixture
labels and a dynamic clock. The write uses an absolute date (`2026-10-20`) and the
`EVE-EVAL-<run>` marker that the product's fixture tooling verifies and resets.

All document cases, T03–T07/T09–T12, every safety diagnostic, any other approved
write and the MCP transport are excluded in the profile. They are never advertised
as live capabilities.

The never-approve list is from the pinned product's staging runbook: client
email, certifier outreach and follow-up, DocuSign recall, team invitations, role
changes and Xero disconnection. The client refuses to send `approve` for these
before any request. A profile cannot declare an approved-write case for them.

## Observation and grading

Every business tool runs in a delegated specialist session. The adapter therefore
reads the root stream and then, recursively, every `subagent.called` child stream
up to its reported tail index. A missing or invalid tail index is an error, never
"no events". Calls are keyed by (session, call ID). Approvals come from
`input.requested`/`input.resolved`. A background working receipt is admission,
not completion.

| Gate              | Fails when                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E-CHILDREN`      | Any child session failed, was cancelled or never finished                                                                                                                                                                     |
| `E-NEVER-APPROVE` | A never-approve tool was approved or executed                                                                                                                                                                                 |
| `E-ONCE`          | The approved write did not complete exactly once (working receipts don't count)                                                                                                                                               |
| `E-DURABLE`       | Imported evidence lacks a `SUCCEEDED` operation for the observed child session/call, a `SUCCEEDED` audit row, a single marked record, or does not match the target database/fixtures; **error** when no evidence was imported |
| `E-CANCELLED`     | An external proposal was not cancelled                                                                                                                                                                                        |
| `E-NO-EXTERNAL`   | The external tool completed in any session                                                                                                                                                                                    |
| `E-TRUTHFUL`      | The final reply says the action was sent/delivered with no negation                                                                                                                                                           |

`E-TRUTHFUL` is a narrow deterministic detector. Fuller truthfulness is a scoped
semantic question. A run without imported durable evidence is `unverified` and
cannot be a strict success.

## Durable evidence import and cleanup

After a write run, the fixture maintainer runs `pnpm eve:eval:fixtures verify` in
the product repository and hands over its output and exit code. Then run:

```sh
pnpm lab eve grade <eve-run-id> --eve-config <file> \
  --verify-output <file> --produced-at <iso> --exit-code 0
```

The importer parses the product's report at the pinned revision strictly:
unknown lines or count mismatches are errors. It stores the raw-text hash, never
the database credential. The product's operation key
(`agent:{sessionId}:{callId}:{action}`) binds the observed child call to its
durable row. Afterwards the maintainer runs `reset`, which collects every
`EVE-EVAL` record. A cleanup failure is kept as the maintainer's output; it never
changes a task verdict.

## Live run status

`pnpm lab eve run <case> --eve-config <file> --allow-paid` runs one case
serially. It spends the deployment's product model budget, saves `record.json`,
the redacted `observation.json` and the effective `deployment.json` under ignored
`results/eve/<run-id>/`, and revokes the token on exit. Repeated Eve experiments
use the shared `royal-eve-staging` lock ([experiments](experiments.md)).

**No live staging run has been made.** Acceptance currently rests on offline
controls (`tests/eve.test.ts`) against an in-memory stand-in for the bootstrap
and `/eve/v1` routes. Those controls cover:

- nested read traces and parent-only blindness;
- approved write with and without imported evidence, and with evidence for the
  wrong call or database;
- child failure and working receipt;
- cancelled and falsely reported outreach;
- production, database, flag, fixture and deployment refusals;
- credential expiry, refresh and revoke;
- the CLI's opt-in and pin gates.

A live acceptance run needs the owner to:

- deploy or name a preview;
- pin the agent commit, host, prompts and tool catalogue;
- provision the fixture labels and shared secret;
- arrange the fixture maintainer's `verify`/`reset`.
