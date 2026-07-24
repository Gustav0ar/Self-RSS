# Plan 022: Enforce absolute and idle expiration for durable auth sessions

> **Executor instructions**: Follow each step, add the named tests, and use
> `mise exec -- bun` for Bun commands. Preserve the fail-closed Redis revocation
> behavior added in plan 017.
>
> **Drift check**: `git diff --stat b34c5b9..HEAD -- packages/api/src/db/schema.ts packages/api/src/repositories/auth-session.repository.ts packages/api/src/services/auth.service.ts packages/api/src/routes/auth.ts packages/api/src/config packages/api/src/jobs packages/api/tests packages/api/drizzle .env.example docker-compose.yml`

## Status

- **State**: DONE
- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

Opaque refresh sessions are currently valid until explicitly revoked. Browser
cookie expiry is not a server-side security boundary, so a copied token can
remain usable indefinitely and abandoned rows accumulate forever. This plan
adds an absolute lifetime, an idle lifetime, and bounded cleanup without
weakening immediate revocation.

## Current state

- `packages/api/src/db/schema.ts:57-84` stores creation, last-seen, rotation,
  and revocation timestamps but no expiration timestamp.
- `packages/api/src/repositories/auth-session.repository.ts:49-60` defines
  active as `revokedAt IS NULL`.
- `packages/api/src/services/auth.service.ts:136-160,211-260` refreshes and
  validates access sessions without checking age.
- `packages/api/src/routes/auth.ts:12-20` hard-codes a 400-day cookie.
- `packages/api/src/config/env.ts` uses Zod defaults and cross-field validation;
  match that convention.
- `packages/api/src/jobs/scheduler.ts` is the composition point for recurring
  cleanup work. Cleanup must be bounded and must not make API startup depend on
  Redis availability.

## Scope

**In scope**: session schema/migration, auth-session repository and service,
auth cookie configuration, bounded cleanup, environment documentation, unit
and integration tests, generated Drizzle artifacts.

**Out of scope**: access-token JWT lifetime, password policy, backup policy,
OAuth, or changing session revocation semantics.

## Steps

1. Add validated configuration for absolute session lifetime, idle lifetime,
   and cleanup batch size. Use conservative production defaults, require idle
   lifetime not to exceed absolute lifetime, and derive cookie max-age from the
   absolute lifetime instead of a separate constant.
   **Verify**: `mise exec -- bun run --filter '@self-feed/api' test -- tests/unit/env.test.ts`
   exits 0 with valid/default/invalid cross-field cases.
2. Add an indexed `expiresAt` column to `auth_sessions`. Generate a migration
   that backfills existing rows from `createdAt + absolute lifetime` without
   deleting current sessions during migration.
   **Verify**: `mise exec -- bun run db:generate` exits 0 and the generated SQL
   contains the new column, backfill, and index.
3. Make every active lookup, compare-and-swap rotation, touch, list, and access
   cache population enforce both `expiresAt > now` and
   `lastSeenAt + idle lifetime > now`. An expired session must behave exactly
   like a revoked session and must never be cached as active.
   **Verify**: targeted repository and auth-service tests pass.
4. Add a bounded repository cleanup method for expired and sufficiently old
   revoked rows, wire it into the worker scheduler, and expose counters/logs
   without user identifiers or token material.
   **Verify**: scheduler tests prove cleanup is bounded, repeatable, and does
   not delete active rows.
5. Update session-list responses so expired rows are omitted. Add integration
   coverage for refresh immediately before/after expiry, idle expiry,
   rotation extending idle activity without extending absolute expiry, and
   access-token rejection after session expiry.

## Test plan

- Extend `packages/api/tests/unit/auth.service.test.ts` and repository tests.
- Extend auth integration tests with a controllable clock; do not use sleeps.
- Add migration characterization for a pre-existing session row.
- Run:
  `mise exec -- bun run --filter '@self-feed/api' test`,
  `mise exec -- bun run test:integration`,
  `mise exec -- bun run typecheck`, and `mise exec -- bun run lint`.

## Done criteria

- Expired/idle sessions cannot refresh or authorize access tokens.
- Rotation updates activity but cannot extend absolute expiry.
- Cookie lifetime and server absolute lifetime have one configuration source.
- Cleanup is bounded, tested, and emits no sensitive data.
- Drizzle generation produces no unexplained drift.

## STOP conditions

Stop if the migration would invalidate every active production session at
deploy, if enforcement would bypass the Redis revocation tombstone, or if a
clock-based test requires real waiting.

## Maintenance notes

Review future changes to `JWT_REFRESH_EXPIRES_IN`: it protects legacy JWT
refresh tokens and must not silently diverge from the durable-session policy.
