# Plan 015: Release failed HTTP responses before retrying

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/web/src/lib/api.ts packages/web/tests/unit/api.test.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plan 009
- **Category**: perf
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

`withRetry` abandons retriable 5xx responses without consuming or cancelling
their bodies. During an outage, repeated GETs can retain streams/connections and
increase pressure on both browser and server.

## Current state

`packages/web/src/lib/api.ts:299-336` retries a response after sleeping at
lines 316-320. Existing API tests are the pattern for mocked fetch, abort, and
retry timing behavior.

## Scope

In scope: `api.ts` and its focused unit test file.
Out of scope: retry counts, retrying mutation methods, backoff constants, or API
server behavior.

## Steps

1. Before waiting for another attempt, cancel the retriable response body with
   a helper that safely handles null bodies and cancellation rejection.
2. Never cancel the final response returned to the caller, a successful
   response, or a non-retriable 4xx response.
3. Preserve AbortSignal semantics and the original error if cancellation
   itself fails.

## Verification

- Tests cover 500/502 cancellation, null body, cancellation rejection, final
  5xx ownership, 4xx, success, and abort during backoff.
- `bun run --filter '@self-feed/web' test -- tests/unit/api.test.ts`,
  web typecheck, and lint exit 0.

## STOP conditions

Stop if Bun/DOM typings make `ReadableStream.cancel()` unavailable or if a test
shows the response returned to `apiFetch` is consumed.

## Maintenance notes

Every retry loop that abandons a `Response` owns cleanup of that response.
