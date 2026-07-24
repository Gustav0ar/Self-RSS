# Plan 023: Roll back failed realtime subscriptions atomically

> **Drift check**: `git diff --stat b34c5b9..HEAD -- packages/api/src/services/realtime.service.ts packages/api/src/routes/events.ts packages/api/tests/unit/realtime.service.test.ts packages/api/tests/unit/events.route.test.ts`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

`RealtimeService.subscribe` increments handler, per-user connection, and metric
state before Redis confirms the channel subscription. A transient Redis
failure therefore consumes a connection slot permanently and can lock a user
out of SSE until process restart.

## Current state

- `packages/api/src/services/realtime.service.ts:71-85` mutates local state,
  then awaits `subscriber.subscribe(channel)`.
- `packages/api/src/routes/events.ts:73-89` can clean the HTTP registry after
  rejection, but no service cleanup callback exists when subscribe throws.
- `packages/api/tests/unit/realtime.service.test.ts:187-257` covers connection
  limits and normal cleanup; follow its fake-subscriber pattern.

## Scope

In scope: realtime service transaction/rollback, route behavior if needed,
connection metrics, focused tests. Out of scope: changing SSE protocol,
connection limit, reconnection policy, or Redis topology.

## Steps

1. Add a failure-capable fake subscriber test proving a rejected first
   `subscribe` leaves no channel handler, no user connection, and no positive
   connection metric.
2. Refactor registration so first-channel Redis subscription either succeeds
   before committing local state or uses a single idempotent rollback path.
   Concurrent subscriptions for the same channel must not issue duplicate
   Redis subscribes or remove a successful peer.
3. Cover failure followed by retry, failure on one user while another remains
   connected, double cleanup, and shutdown during a pending subscription.
4. Confirm the events route closes its local connection registry once and
   surfaces the stream error without an unhandled rejection.

## Verification

- `mise exec -- bun run --filter '@self-feed/api' test -- tests/unit/realtime.service.test.ts tests/unit/events.route.test.ts`
  exits 0.
- `mise exec -- bun run typecheck` and `mise exec -- bun run lint` exit 0.
- New assertions prove `getConnectionCount()` returns its original value after
  every rejected subscription.

## STOP conditions

Stop if correctness requires replacing the Redis client or changing the public
SSE event schema. Do not hide failures by decrementing only the metric while
leaving handlers or connection maps populated.

## Maintenance notes

Every future state mutation added to subscription setup must participate in
the same commit/rollback boundary.
