# Plan 016: Make Redis counters and expiration atomic

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/api/src/utils/rate-limiter.ts packages/api/tests`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plan 009
- **Category**: security
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

Both rate-limit counters perform `INCR` and expiry as separate round trips. A
process or Redis connection failure between them leaves a permanent counter,
which can permanently deny a user or preserve a quota key indefinitely.

## Current state

- `rate-limiter.ts:34-37`: `INCR`, then conditional `PEXPIRE`.
- `rate-limiter.ts:69-73`: daily `INCR`, then conditional `EXPIRE`.
- The repository already uses small atomic Lua scripts in
  `services/redis-owned-lock.ts` and `feed-sync-status.ts`; match that style.

## Scope

In scope: `rate-limiter.ts` and focused unit/integration tests.
Out of scope: limit values, failure-mode policy, key identity, Redis deployment
configuration.

## Steps

1. Add a private Lua-backed helper that atomically increments and sets a TTL
   only for a new key. Use millisecond TTL for window limits and an explicit
   48-hour TTL for daily quotas.
2. Parse and validate the Redis return value. Keep current failure-open/closed
   behavior and structured logging unchanged.
3. Add tests for first increment TTL, subsequent increment preserving TTL,
   concurrent increments, and Redis failure.

## Verification

- Targeted rate-limiter unit tests pass.
- `bun run test:integration` proves a created counter has a positive bounded
  PTTL and concurrent calls produce exact counts.
- API typecheck and lint exit 0.
- `rg -n 'incr\\(|pexpire\\(|expire\\(' packages/api/src/utils/rate-limiter.ts`
  shows no split counter/expiry sequence.

## STOP conditions

Stop if the chosen Redis script changes existing allowed/remaining semantics or
if test doubles cannot faithfully represent `eval` without an integration test.

## Maintenance notes

Keep scripts minimal, deterministic, and free of user-controlled source text.
Arguments belong in `ARGV`; keys belong in `KEYS`.
