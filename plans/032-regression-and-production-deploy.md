# Plan 032: Validate the complete batch and deploy it to production

> **Executor instructions**: Do not weaken, skip, quarantine, or retry-away a
> failing gate. Use mise for Bun. Deploy only the exact reviewed commit, and
> approve only the newest production run for that SHA.
>
> **Drift check**: `git diff --stat b34c5b9..HEAD`

## Status

- **State**: DONE
- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans 022-031
- **Category**: tests
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

This batch changes authentication lifetime, realtime accounting, retry
semantics, cross-platform administration, Android session storage/deep links,
article contracts, and feed diagnostics. Production rollout is complete only
after one clean local proof, browser/device smoke checks, the exact commit is
pushed, every triggered workflow is green, and production health is verified.

## Scope

In scope: fixes strictly required for planned behavior, plan status updates,
intentional generated artifacts, commit/push to production main, workflow
monitoring/approval, and smoke verification.

Out of scope: backups (explicitly excluded by the user), unrelated refactors,
deploying an older SHA, bypassing failed CI, changing production secrets, or
clearing production data.

## Pre-deploy review

1. Confirm plans 022-031 are DONE and `git status -sb` contains only this batch.
2. Inspect every diff for auth invariants, ownership checks, secret leakage,
   unsafe HTML, main-thread Android I/O, wildcard intent filters, retry
   amplification, and generated contract/migration correctness.
3. Confirm all new externally visible copy is localized on Android and all web
   controls have labels, focus, and actionable error states.

## Required local gates

| Gate | Command | Expected |
|------|---------|----------|
| Toolchain | `mise install && mise exec -- bun --version` | Bun 1.3.14 |
| Install | `mise exec -- bun install --frozen-lockfile` | exit 0 |
| New aggregate gate | `mise exec -- bun run check:all` | exit 0 |
| Migration drift | `mise exec -- bun run db:generate && git diff --exit-code -- packages/api/drizzle` | only already-reviewed migration artifacts |
| OpenAPI drift | `mise exec -- bun run openapi:generate && git diff --exit-code -- packages/api/openapi.json` | only already-reviewed contract artifacts |
| High audit | `mise exec -- bun audit --audit-level high` | no high/critical advisories |

If the generated artifacts are intentionally part of plans 022, 027, 029, or
031, stage them first and then rerun the drift command against the index.

## Interactive validation

1. Start the disposable local stack using the repository's detached-review
   instructions and run `mise exec -- bun run seed:review`.
2. With the in-app browser, validate desktop and narrow/mobile layouts for
   login, ordinary-user navigation, failed search/retry, `v` opening the
   publisher URL, admin console/invariants, feed-health timeline/retry, logout,
   and reconnecting SSE.
3. Use a disposable Android emulator/test variant to validate login/session
   restart, admin and ordinary-user settings, article/feed deep links, process
   recreation, feed history, and offline/error recovery.
4. Stop all disposable services and verify ports 3000/5173/6379 are released.

## Publish and deploy

1. Run `git status -sb`, `git diff --check`, and inspect the complete staged
   diff. Commit only planned files with a terse subject describing the batch.
2. Fetch origin and confirm the branch contains exactly `origin/main` plus the
   reviewed commits. If origin/main advanced, rebase/reconcile and rerun every
   gate; never force-push over new work.
3. Push the reviewed HEAD to `origin/main` following `DEPLOY.md` and the
   repository's direct-production workflow.
4. List every GitHub Actions run for the pushed SHA. Wait for `CI`, `Security`,
   `Containers`, and any triggered `Android CI` to finish successfully.
5. Approve the newest waiting `Deploy` run only when its `headSha` matches and
   all prerequisite workflows for that SHA are green. Never approve a
   superseded run.
6. Wait for Deploy success, then verify the public health/ready endpoints and
   web root. Perform authenticated smoke checks without logging secrets.

## Done criteria

- Plans 022-031 and every required local gate are DONE/green.
- Browser and disposable Android smoke matrices pass.
- The pushed commit list is exact and contains no unrelated user changes.
- Every workflow triggered for the production SHA finishes successfully.
- Production Deploy succeeds and public API/web smoke checks pass.
- Plan 032 and the index are marked DONE with deployed SHA and workflow URLs
  recorded in the execution log/commit or final report.

## STOP conditions

Stop on any test flake, migration/data-loss concern, security/audit failure,
unreviewed origin/main change, missing GitHub authentication, ambiguous
production approval, failed workflow, or production health regression. Do not
approve an older run or use force push/reset to recover.

## Maintenance notes

Rollback must follow `DEPLOY.md` and preserve database compatibility. Because
backup work was explicitly excluded, do not invent or modify backup behavior
inside this plan.
