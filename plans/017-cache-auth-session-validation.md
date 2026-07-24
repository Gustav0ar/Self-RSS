# Plan 017: Cache active-session validation without weakening revocation

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/api/src/db/redis.ts packages/api/src/services/auth.service.ts packages/api/src/repositories/auth-session.repository.ts packages/api/tests`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 016
- **Category**: perf
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

Every protected request verifies the JWT and then queries SQLite for the same
active session. A bounded Redis cache can remove the hot read while preserving
the current immediate-revocation behavior.

## Current state

- `middleware/auth.ts:15-24` calls `isAccessSessionActive` on every request.
- `auth.service.ts:182-190` always calls `findActiveById`.
- `auth-session.repository.ts:49-52` performs the SQLite query.
- `db/redis.ts:38-89` centralizes key names and TTLs.

## Scope

In scope: Redis keys/TTLs, AuthService validation and all session
creation/revocation/logout paths, focused unit and integration tests.
Out of scope: JWT format, access-token lifetime, refresh-token rotation
semantics, or relaxing revocation.

## Steps

1. Add namespaced active-session and revoked-session keys. Active entries store
   the owning user ID with a short TTL (at most 60 seconds); every key has a
   TTL.
2. Validation order must be: check revoked tombstone, check active owner, query
   SQLite on miss, check tombstone again, then cache the active owner. A
   tombstone always wins over an active entry.
3. After every successful revoke/logout, write the tombstone and delete the
   active entry. If a session is newly issued, clear stale tombstones before
   caching it. Redis failures must fall back to SQLite, not sign users out.
4. Add concurrency regression coverage where a validation miss overlaps a
   revoke; subsequent validation must be false immediately.

## Verification

- Unit tests prove cache hits avoid repository reads, ownership mismatches fail,
  Redis failure falls back, and tombstones dominate stale active entries.
- Integration tests prove revoke/logout invalidation and TTLs.
- `bun run --filter '@self-feed/api' test`, `bun run test:integration`,
  typecheck, and lint pass.

## STOP conditions

Stop if any path can accept a revoked session until the active TTL expires, or
if Redis unavailability changes current authentication availability.

## Maintenance notes

Revocation correctness outranks cache hit rate. Any new session mutation must
update both cache namespaces or deliberately bypass them.
