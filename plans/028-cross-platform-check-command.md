# Plan 028: Add one complete cross-platform quality command

> **Drift check**: `git diff --stat b34c5b9..HEAD -- package.json scripts README.md CLAUDE.md .github/workflows`

## Status

- **State**: DONE
- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

`test:all` sounds repository-wide but excludes Android because Android is not a
Bun workspace package. Lint, build, generated-contract drift, and audit are
also separate. Contributors need one truthful pre-release command while
retaining faster focused commands.

## Current state

- `package.json:5-9` includes only shared, API, and web workspaces.
- `package.json:19` defines `test:all` as Bun tests, API integration, and web
  E2E.
- `package.json:35` exposes Android verification separately.
- `README.md:106-111` calls `test:all` “All Suites” without clarifying the
  platform boundary.
- `mise.toml` pins Bun 1.3.14; all documented top-level invocations must use
  `mise install` / `mise exec -- bun`.

## Scope

In scope: root scripts, a small orchestration script if needed, README and
repository instructions, deterministic generated-file checks. Out of scope:
combining CI jobs, changing test frameworks, installing Android SDKs, or
removing focused commands.

## Steps

1. Add `check:all` that sequentially runs lint/architecture, TypeScript,
   workspace unit tests, API integration, browser E2E, builds, OpenAPI
   generation with a drift check, Android check, and high-severity Bun audit.
   Fail on the first gate and preserve that gate's exit code.
2. Keep `test:all` as a fast Bun/web/API suite or rename its documentation to
   “Bun + browser suites”; do not silently add Android to a command used by
   existing fast workflows.
3. Make generated-file checks restore nothing destructively. A generated
   change must remain visible and fail with an actionable message.
4. Document `mise install`, `mise exec -- bun run check:all`, prerequisites,
   expected duration, and the focused alternatives.
5. Add a unit test for the orchestrator's command order/failure propagation if
   logic moves beyond a static package script.

## Verification

- `mise install` installs the pinned Bun release.
- `mise exec -- bun run check:all` exits 0 on the current repository.
- A controlled failing child in an orchestrator test stops later gates and
  returns non-zero.
- `mise exec -- bun run lint` confirms docs/scripts formatting.

## STOP conditions

Stop if the command would mutate tracked generated files and then hide the
diff, require production secrets, or run connected-device tests against a
user's normal Android app.

## Maintenance notes

Every new platform or generated contract must be added to `check:all` and to
CI in the same change.
