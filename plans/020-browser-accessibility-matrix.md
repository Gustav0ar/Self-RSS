# Plan 020: Add mobile-browser and automated accessibility coverage

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/web/playwright.config.ts packages/web/tests/e2e packages/web/package.json bun.lock scripts/run-playwright.ts .github/workflows/ci.yml`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans 010-014
- **Category**: tests
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

The E2E suite runs only Desktop Chromium. Mobile layout, touch-oriented
controls, Firefox/WebKit smoke compatibility, and automated accessibility
regressions are currently invisible to CI.

## Current state

`packages/web/playwright.config.ts:14-19` declares one Desktop Chrome project.
The suite already has stable auth helpers and ephemeral API/Redis orchestration
in `scripts/run-playwright.ts`.

## Scope

In scope: Playwright config, focused new E2E specs/helpers, the web test
dependency/lockfile, and CI browser installation.
Out of scope: duplicating all long-running feed-worker tests across every
browser or declaring automated scans a substitute for manual accessibility QA.

## Steps

1. Add the pinned Playwright-compatible axe integration.
2. Keep the complete suite on Desktop Chromium. Add targeted projects/specs for
   Mobile Chrome, Firefox, and WebKit covering login, sidebar/drawer,
   list-to-reader-back navigation, search, preferences, and mark-all safety.
3. Add axe scans at stable states for login, empty onboarding, populated
   reader, preferences, and feed management. Assert no serious/critical
   violations and document reviewed exceptions.
4. Do not run the 170-second worker/cooldown scenarios in every project; use
   `testMatch`, tags, or project dependencies to keep the matrix bounded.
5. Configure traces/screenshots on failure and ensure CI installs the exact
   browsers for the pinned web Playwright package.

## Verification

- `bun run --filter '@self-feed/web' test:e2e:runner -- --list` shows desktop
  full coverage plus bounded mobile/Firefox/WebKit/a11y projects.
- `bun run test:e2e` passes locally without public-network dependencies.
- CI configuration installs matching browsers; `bun run lint`, typecheck, and
  frozen install pass.

## STOP conditions

Stop if the matrix duplicates slow worker tests, requires root-level Playwright
installation, or introduces flaky timing sleeps instead of observable-state
waits.

## Maintenance notes

Every new responsive navigation or modal flow should add one targeted mobile
assertion. Axe results require human review; do not blanket-disable rules.
