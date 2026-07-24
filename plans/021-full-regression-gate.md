# Plan 021: Run the complete cross-platform regression gate

> **Drift check**: `git diff --stat 49e78b4..HEAD`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans 009-020
- **Category**: tests
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

The batch changes failure handling, mutation sequencing, Redis authentication
behavior, browser coverage, and Android resources/build metadata. Completion
requires one clean, cross-platform proof that generated contracts and existing
features still work together.

## Scope

In scope: tests or implementation corrections strictly required to make the
planned behavior pass; `plans/README.md` status updates.
Out of scope: unrelated refactors, deployment, pushing, or approving production.

## Steps

1. Confirm plans 009-020 are DONE and inspect `git status -sb`; preserve the
   pre-existing `CLAUDE.md` edit.
2. Run targeted tests named in each plan, then the complete gates below.
3. Regenerate OpenAPI and Drizzle artifacts only to verify drift. If generated
   output changes unexpectedly, stop and identify the originating plan.
4. Review the combined diff for out-of-scope files, raw user-facing Android
   strings, missing web query errors, split Redis counter expiry, and unbounded
   cross-browser test duplication.

## Required gates

| Gate | Command | Expected |
|------|---------|----------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Types | `bun run typecheck` | exit 0 |
| Unit | `bun run test:unit` | all pass |
| API integration | `bun run test:integration` | all pass |
| Browser E2E | `bun run test:e2e` | all configured projects pass |
| Web/API build | `bun run build` | exit 0 |
| Android | `bun run android:check` | tests, lint, debug/release and R8 pass |
| Audit | `bun audit --audit-level high` | no high/critical advisories |
| OpenAPI | `bun run openapi:generate && git diff --exit-code -- packages/api/openapi.json` | no unintended drift |
| Migrations | `bun run db:generate && git diff --exit-code -- packages/api/drizzle` | no unintended drift |

## Done criteria

- Every required gate passes from a clean service state.
- No test uses external public feeds or fixed sleeps for correctness.
- Only planned source/test/config files, `bun.lock` when justified, the existing
  `CLAUDE.md` edit, and plan status updates are modified.
- Plans 009-021 are marked DONE with no unresolved BLOCKED item.

## STOP conditions

Stop on any high/critical advisory, contract/migration drift, flaky retry,
unexpected tracked artifact, or failure requiring an unrelated production
change. Do not push, deploy, or approve workflows without explicit operator
instruction.

## Maintenance notes

This is a verification plan, not permission to hide failures or broaden scope.
Record exact failing commands and diagnostics for any BLOCKED status.
