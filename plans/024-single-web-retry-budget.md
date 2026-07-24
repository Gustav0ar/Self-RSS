# Plan 024: Give web reads one bounded retry budget

> **Drift check**: `git diff --stat b34c5b9..HEAD -- packages/web/src/lib/api.ts packages/web/src/providers/query.tsx packages/web/src/hooks packages/web/tests/unit`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

The transport retries each GET up to three times and TanStack Query retries the
entire query once, producing as many as six requests for one user action.
During an outage this amplifies server load and delays actionable error states.

## Current state

- `packages/web/src/lib/api.ts:2-5,144-163,308-346` owns a three-attempt,
  abort-aware transport retry loop and releases discarded response bodies.
- `packages/web/src/providers/query.tsx:7-13` also configures `retry: 1`.
- Mutations are deliberately not retried by `authorizedFetch`; preserve that
  safety boundary.

## Scope

In scope: query retry defaults, transport retry policy/documentation, attempt
count tests, cancellation and `Retry-After` behavior if already supported.
Out of scope: API server retry behavior, Android retry policy, circuit
breakers, or increasing timeouts.

## Steps

1. Add characterization tests that count real `fetch` calls for a successful
   GET, retriable 5xx, network failure, abort during backoff, non-retriable 4xx,
   and mutation failure.
2. Make the transport the single default owner of GET retries by disabling
   TanStack's additional automatic retry. Allow a query to opt into a
   different policy only through an explicit documented helper and test.
3. Ensure the final response/error is returned after exactly three total
   attempts, abort cancels immediately, response bodies are released between
   attempts, and POST/PATCH/DELETE remain single-attempt.
4. Add a short comment in `query.tsx` explaining why global retry is disabled
   so future upgrades do not restore amplification.

## Verification

- `mise exec -- bun run --filter '@self-feed/web' test -- tests/unit/api-retry.test.ts tests/unit/query-provider.test.tsx`
  exits 0; create or adapt filenames to the existing API test layout.
- `mise exec -- bun run --filter '@self-feed/web' typecheck` and
  `mise exec -- bun run lint` exit 0.
- A retriable query produces three fetches, never six.

## STOP conditions

Stop if a test reveals a business-critical query intentionally depends on
TanStack retries beyond the transport budget; document the exact query before
adding an exception.

## Maintenance notes

Retry count, timeout, and user-visible error timing are one policy. Review them
together rather than tuning each layer independently.
