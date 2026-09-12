# Implementation Plans

## 2026-09-11 Android experience and resilience batch

Start here for the current Android work. Plans 033–049 turn the Android review and Gustavo's follow-up requirements into implementation handoffs, based on commit `74d5c11`. Implementation and separate review PRs are now authorized. Track current work and validation in [the execution record](android-review/progress.md). The original review was read-only.

The review traced source and test behavior. It did not measure real-device performance or reproduce every visual symptom. Each defect plan requires a focused reproduction, and performance plans require measured evidence before claiming improvement.

These rules apply to **033–049**. Earlier branch, roadmap-wait, deployment, and release instructions below belong to completed historical batches. This request explicitly includes Android offline support and UX planning; it does not authorize executing an old deployment gate.

### Execution order and status

| Plan | Work package | Priority | Effort | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| [033](033-android-review-verification-foundation.md) | Establish isolated Android behavior and performance fixtures | P1 | M | none | IMPLEMENTED; hardware pending |
| [034](034-android-design-and-motion-selection.md) | Select Android layout, loading, offline, and motion designs | P1 | M | none | TODO |
| [035](035-android-session-and-request-lifecycle.md) | End account and reader sessions without accepting stale work | P1 | L | 033 | TODO |
| [036](036-android-cache-first-and-mutation-authority.md) | Return cached content immediately and preserve the latest mutation | P1 | L | 033, 035 | TODO |
| [037](037-android-main-safe-io.md) | Keep networking, document reads, and body preparation off Main | P1 | M | 033, 035 | TODO |
| [038](038-android-loading-and-error-lifecycle.md) | Keep loading continuous and make failures recoverable | P1 | L | 033, 034, 035, 036, 037 | TODO |
| [039](039-android-media-and-reader-resource-lifecycle.md) | Pause inactive media and release reader resources predictably | P1 | L | 033, 035 | TODO |
| [040](040-android-reader-readiness-and-fallback.md) | Show usable reader content without placeholder loops or layout jumps | P1 | M | 033, 034, 037, 038, 039 | TODO |
| [041](041-android-cache-retention-and-budgets.md) | Bound cache maintenance and protect retained offline content | P1 | L | 033, 035, 036, 037 | TODO |
| [042](042-android-durable-offline-downloads.md) | Resume offline downloads and serve cached media to the reader | P1 | L | 033, 034, 035, 036, 037, 039, 040, 041 | TODO |
| [043](043-android-reading-session-restoration.md) | Restore reading context after process recreation | P2 | M | 033, 035, 040, 042 | TODO |
| [044](044-android-reader-idle-and-long-article-performance.md) | Stop idle HTML work and bound long-article rendering cost | P2 | L | 033, 037, 039, 040, 043 | TODO |
| [045](045-android-dense-queue-and-search.md) | Make article queues and search dense, truthful, and accessible | P2 | L | 033, 034, 038, 042, 043 | TODO |
| [046](046-android-adaptive-reader-and-motion.md) | Implement the selected adaptive reader layout and finite motion | P2 | L | 033, 034, 038, 039, 040, 043, 044, 045 | TODO |
| [047](047-android-feed-settings-and-draft-resilience.md) | Simplify management navigation and preserve unfinished edits | P2 | L | 033, 034, 035, 037, 038, 042, 043, 045 | TODO |
| [048](048-android-realtime-gap-recovery.md) | Recover realtime delivery gaps without losing local intent | P2 | M | 033, 035, 036, 038 | TODO |
| [049](049-android-final-ux-resilience-performance-gate.md) | Validate the complete Android experience on isolated targets | P1 | L | 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048 | TODO |

Effort is relative scope, not a delivery estimate. P1 protects correctness, access, or core reading behavior; P2 improves usability or efficiency. Status values are `TODO`, `IN PROGRESS`, `AWAITING SELECTION`, `DONE`, and `BLOCKED: <concrete reason>`. Do not mark a hardware-dependent claim verified without its evidence.

### How to execute

1. Start [033](033-android-review-verification-foundation.md) to establish fixtures that match production Room bindings, actual rich-reader readiness, safe device targeting, and an isolated performance build. Record the fixture-only baseline commit.
2. Prepare the distinct design options in [034](034-android-design-and-motion-selection.md). Publish and inspect them, then record Gustavo's explicit choice before changing real layout or copy. Mechanical fixes that preserve existing presentation can proceed while the choice is pending.
3. Establish account/request lifetime in [035](035-android-session-and-request-lifecycle.md). Complete cache-first reads and mutation authority in [036](036-android-cache-first-and-mutation-authority.md), main-safe work in [037](037-android-main-safe-io.md), and inactive-media/resource ownership in [039](039-android-media-and-reader-resource-lifecycle.md) against that contract.
4. Implement the selected loading lifecycle [038](038-android-loading-and-error-lifecycle.md) and reader readiness/fallback [040](040-android-reader-readiness-and-fallback.md). Introduce bounded retention [041](041-android-cache-retention-and-budgets.md) before durable offline acquisition [042](042-android-durable-offline-downloads.md). Apply Room schema migrations in that order, each with its own new version.
5. Build restoration [043](043-android-reading-session-restoration.md), measured reader performance [044](044-android-reader-idle-and-long-article-performance.md), shared queue/search UX [045](045-android-dense-queue-and-search.md), adaptive layout/motion [046](046-android-adaptive-reader-and-motion.md), and resilient management/settings [047](047-android-feed-settings-and-draft-resilience.md). Realtime recovery [048](048-android-realtime-gap-recovery.md) can follow its own listed dependencies.
6. Finish [049](049-android-final-ux-resilience-performance-gate.md) against the integrated result. It records actual behavior, migrations, accessibility, physical performance, and remaining limits.

Dependencies identify required contracts. A completed deterministic fixture can support downstream tests while a separate physical measurement remains pending in 033; that does not make 033 or the final gate DONE. If baseline hardware is unavailable initially, preserve the fixture-only commit and compare it later using the same device/configuration.

Use an isolated checkout and reconcile source drift before each plan. Sequence work on overlapping files. If parallel execution is later authorized, assign non-overlapping file ownership up front; repository, ViewModel, reader, and schema changes must not race. Plans 041 and 042 must never allocate schema versions independently.

### Coverage of the review and requested behavior

| Requirement or finding | Owning plans | Required evidence |
| --- | --- | --- |
| Loading appears/disappears repeatedly during one refresh | [038](038-android-loading-and-error-lifecycle.md), [040](040-android-reader-readiness-and-fallback.md) | Reproduced visibility trace; one operation through final visible reconciliation and terminal success/failure |
| Cached reads blocked by slow pending writes | [036](036-android-cache-first-and-mutation-authority.md) | Cached body/queue available while mutation transport is held indefinitely |
| Back followed by late article reopening; account data or credentials crossing sessions | [035](035-android-session-and-request-lifecycle.md) | Delayed success, error, dispatch, and 401 across close/account/server changes |
| Read/save acknowledgement or realtime event overwrites newer local intent | [036](036-android-cache-first-and-mutation-authority.md), [048](048-android-realtime-gap-recovery.md) | Adversarial acknowledgement/revision order and durable outbox convergence |
| Main-thread cookie refresh, OPML reads, JSON/HTML parsing | [037](037-android-main-safe-io.md) | Controlled dispatcher tests and device StrictMode/responsiveness checks |
| Media continues on inactive retained pages or in background | [039](039-android-media-and-reader-resource-lifecycle.md) | Actual local HTML5 playback paused on swipe/tab/background/close; no autoplay on return |
| Leaked reader/context/fullscreen callbacks; renderer process loss | [039](039-android-media-and-reader-resource-lifecycle.md), [040](040-android-reader-readiness-and-fallback.md) | Bounded live views, idempotent teardown, recoverable renderer replacement |
| Permanent placeholders, wrong ready marker, anchor jump, false completion | [040](040-android-reader-readiness-and-fallback.md) | Failed/partial/cached states, actual document readiness and preserved reading anchor |
| Cache growth and full saved-archive scans during detail writes | [041](041-android-cache-retention-and-budgets.md) | Bounded maintenance, byte budgets, pressure/corruption tests and data-preserving migrations |
| Offline text/images unavailable after save or process death | [042](042-android-durable-offline-downloads.md) | Durable intent, restart/resume and actual rich-reader image rendering with network rejected |
| Truthful offline status, local search/filter, storage/removal controls | [042](042-android-durable-offline-downloads.md), [045](045-android-dense-queue-and-search.md) | Text/media availability matches persisted resources; clear partial/failure/removal behavior |
| Reading position, scope and query lost after recreation | [043](043-android-reading-session-restoration.md) | Separate-process test runner survives target death; durable owner, stable anchors and paused media |
| Reader observer work at idle; expensive or truncated long content | [044](044-android-reader-idle-and-long-article-performance.md) | Real generated HTML observer test and release measurements of long articles/idle behavior |
| Dense readable article rows; consistent Search; accessible read states | [045](045-android-dense-queue-and-search.md) | Selected layout, query identity, contrast, actual hit targets and TalkBack actions |
| Focused reader; adaptive Back/layout; links, selection and large text | [046](046-android-adaptive-reader-and-motion.md) | Actual pane-state matrix, 200% text, safe links, selection, keyboard and TalkBack |
| Useful animations without endless repainting | [034](034-android-design-and-motion-selection.md), [038](038-android-loading-and-error-lifecycle.md), [045](045-android-dense-queue-and-search.md), [046](046-android-adaptive-reader-and-motion.md), [047](047-android-feed-settings-and-draft-resilience.md) | Selected finite transitions, interruption/zero-scale checks, no app-controlled idle motion |
| Lost editor drafts, premature dismissal, out-of-order preferences | [047](047-android-feed-settings-and-draft-resilience.md) | Failed/retried/recreated edits; late GET cannot overwrite a newer PATCH in storage or UI |
| Silent realtime delivery gaps and reconnect churn | [048](048-android-realtime-gap-recovery.md) | Burst larger than channel capacity, slow consumer, safe replay/reconciliation |
| Tests and benchmarks miss actual production reader behavior | [033](033-android-review-verification-foundation.md), [049](049-android-final-ux-resilience-performance-gate.md) | Production binding, real rich-ready signal, isolated minified physical measurements |

### Acceptance boundaries

- Preserve existing user data, saved bodies, sessions and queued read/save changes. Every schema change needs a fresh version, explicit forward migration, exported schema, clean-creation coverage and every supported historical upgrade path, including both version-6 layouts. No destructive fallback.
- Separate disposable cache from retained downloads. Separate renderer lifetime from retained content. Ordinary backgrounding pauses interactive work; account transitions invalidate ownership; durable workers resume only for the right owner. Durable owner identity survives token refresh/process restart and is distinct from the in-memory request generation.
- Follow the selected black #000, white-text, dense design. Use finite, interruptible animation at meaningful transitions. Long-running synchronization needs stable state/progress and a terminal outcome, without a decorative endless spinner, pulse or shimmer.
- Plan 034 must locate the requested `html-communication` skill at execution. It was unavailable during planning. If still unavailable, prepare the mocks and seek approval for a concrete alternate publishing method before publication. No UI implementation is blocked by that missing skill during this planning task.
- Implementation, feature-branch pushes, and separate real PRs are authorized. No API/web redesign, unrelated dependency upgrade, production access, normal-app install, merge or deployment is included. The final gate produces a local acceptance record.
- The device, benchmark and process-recovery wrapper scripts named in these plans are **proposed deliverables of 033**, not existing commands already run. Behavior instrumentation uses `com.selffeed.android.devicetest`; performance/recovery uses a separate verified target application ID. Recovery tests run in a separate test process that survives target death. Never invoke the existing release-startup installer against Gustavo's normal app.
- Verification failures stay visible. Missing measurements and deferred requirements remain incomplete unless Gustavo explicitly changes scope. Do not claim leading performance from source inspection alone.

## Historical batches

The sections below record completed earlier work. Their execution and deployment instructions do not apply to plans 033–049.

Generated by the improve skill on 2026-06-19. Planned at commit `b14d79b`.

These plans cover every finding from the API/web review plus a final e2e release and deployment gate. Execute them in order on a single integration branch unless a plan's STOP conditions require escalation. Each executor must read the relevant plan fully before editing code, run every verification command, and update the status row here when the plan is complete.

## Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [001](001-compatible-article-cache-cursors.md) | Emit compatible article cursors from every cache path | P1 | M | - | DONE |
| [002](002-content-sensitive-article-etags.md) | Make article ETags change when article detail content changes | P1 | M | 001 | DONE |
| [003](003-retry-failed-scheduled-syncs.md) | Retry failed feeds from the scheduled worker with bounded backoff | P1 | M | - | DONE |
| [004](004-category-hierarchy-integrity.md) | Enforce category hierarchy integrity across API, database, and web UI | P1 | L | - | DONE |
| [005](005-safe-silent-article-refresh.md) | Replace unsafe silent article refresh merging with safe refetch behavior | P2 | M | 001 | DONE |
| [006](006-clear-web-state-on-auth-boundaries.md) | Clear web data and selection state on auth boundaries | P2 | S | - | DONE |
| [007](007-harden-rate-limit-proxy-identity.md) | Harden unauthenticated rate-limit identity behind trusted proxies | P1 | M | - | DONE |
| [008](008-e2e-release-and-deploy.md) | Verify, audit, deploy, and smoke test the complete fix set | P0 | M | 001-007 | DONE |

Status values: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED: <reason>`, `REJECTED: <reason>`.

## Global execution rules

- Work on one branch named `advisor/api-web-findings-e2e` unless the operator gives a different branch.
- Before editing, run `git status -sb` and `git log --oneline --decorate -5`. If the working tree contains unrelated user changes, do not overwrite or revert them.
- Match existing repo style: TypeScript, Bun workspace commands, Hono API layering (`routes -> services -> repositories`), React Query hooks, and focused Vitest tests.
- Commit in logical units after tests for that unit pass. Existing commit subjects are short imperative phrases, for example `Fix Playwright install in CI`.
- Do not expose secrets in logs, plans, commit messages, tests, or issue text.
- If a verification gate exposes a regression, stop, preserve diagnostics, and do not proceed to deployment until the regression is understood and fixed.

## Repository verification gates

Run targeted tests inside each plan. Before deployment, plan 008 requires all of these:

| Purpose | Command | Expected result |
|---------|---------|-----------------|
| Lint | `bun run lint` | exit 0, no Biome errors |
| Typecheck | `bun run typecheck` | exit 0, no TypeScript errors |
| Unit tests | `bun run test:unit` | exit 0, all API and web unit tests pass |
| API integration | `bun run test:integration` | exit 0, ephemeral API integration suite passes |
| Web E2E | `bun run --filter '@self-feed/web' playwright:install` then `bun run test:e2e` | exit 0, Playwright E2E passes |
| Build | `bun run build` | exit 0 for shared, api, and web |
| Audit | `bun audit --audit-level high` | exit 0, no high or critical advisories |
| OpenAPI drift | `bun run openapi:generate` then `git diff --exit-code -- packages/api/openapi.json` | exit 0 unless a response contract intentionally changed and was reviewed |

## Deployment gate

Plan 008 is mandatory. Deployment is complete only when all of the following are true for the same `headSha`:

- Local gates above pass.
- `CI`, `Security`, and `Containers` GitHub Actions workflows succeed.
- The protected `Deploy` workflow is approved only after those workflows are green for the same SHA.
- The Deploy workflow finishes successfully and its built-in container health checks pass for Redis, API, worker, and web.
- A post-deploy smoke check confirms the production health endpoint and web root respond successfully.

Use `DEPLOY.md` as the source of truth for production environment assumptions. If the executor cannot identify or approve the correct production deployment, mark plan 008 `BLOCKED` with the exact missing permission or information; do not approve an older or superseded deployment.

## Dependency notes

- Plan 005 depends on plan 001 because silent refresh correctness relies on server pagination tokens being reliable.
- Plan 002 follows plan 001 to keep API article-list changes isolated from article-detail cache validation changes.
- Plan 008 depends on every implementation plan and must not be started until plans 001-007 are either `DONE` or explicitly `REJECTED` because a regression made that finding unsafe to implement.

## Findings considered and rejected

- None. The user explicitly requested a plan for every review finding.

## 2026-07-24 full-app improvement batch

This second batch was generated at commit `5a2575a` after a whole-repository
review. The checked-out branch was 25 commits behind the local `origin/main`
reference when these plans were written. Before dispatching an executor, the
operator must decide whether to execute against this commit or first
fast-forward and run the plans' drift checks. Never overwrite the existing
uncommitted `CLAUDE.md` change.

The implementation request selected the safer option: plans 010-021 were
reconciled against local `origin/main` commit `49e78b4` before dispatch. Plan
009 creates the isolated execution branch from that same commit.

### Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [009](009-pin-bun-runtime.md) | Pin one Bun runtime across local development, docs, and CI | P1 | S | - | DONE |
| [010](010-web-query-failure-states.md) | Give every primary web query an actionable failure state | P1 | M | 009 | DONE |
| [011](011-reliable-preferences-autosave.md) | Preserve preference changes until the server acknowledges them | P1 | M | 010 | DONE |
| [012](012-first-feed-onboarding.md) | Let a new user add a first feed without prerequisite work | P1 | M | 010 | DONE |
| [013](013-safe-mark-all-read.md) | Confirm and report the result of bulk read-state changes | P1 | S | 010 | DONE |
| [014](014-accessible-feed-management.md) | Make feed health and category reordering keyboard- and touch-accessible | P1 | M | 010 | DONE |
| [015](015-cancel-retried-responses.md) | Release failed HTTP responses before retrying | P2 | S | 009 | DONE |
| [016](016-atomic-redis-counters.md) | Make Redis counters and expiration atomic | P1 | S | 009 | DONE |
| [017](017-cache-auth-session-validation.md) | Cache active-session validation without weakening revocation | P2 | M | 016 | DONE |
| [018](018-localize-android-ui.md) | Move Android user-facing text into resources | P2 | L | 009 | DONE |
| [019](019-android-release-versioning.md) | Make Android release versions explicit and monotonic | P2 | S | 009 | DONE |
| [020](020-browser-accessibility-matrix.md) | Add mobile-browser and automated accessibility coverage | P1 | M | 010-014 | DONE |
| [021](021-full-regression-gate.md) | Run the complete cross-platform regression gate | P0 | M | 009-020 | DONE |

### Dependency notes

- 009 runs first so every later executor and CI job use the same Bun release.
- 010 establishes the shared async-state vocabulary used by 011-014.
- 016 precedes 017 because both touch Redis correctness and should use one
  reviewed atomicity/failure-mode convention.
- 020 runs after the web UX plans so its mobile and accessibility assertions
  cover the final behavior rather than transient implementations.
- 021 is mandatory. No implementation batch is complete until every applicable
  unit, integration, E2E, Android, build, audit, and generated-contract gate
  passes with no unrelated tracked-file changes.

### Product roadmap tracked separately

The review also identified saved/starred articles with smart collections, a
web offline/PWA mode, and optional digests/notifications. These are product
initiatives rather than bounded defects and are intentionally not mixed into
the implementation batch above. They require separate product decisions,
schema/API design, and rollout plans.

Roadmap expansion is now evidence-gated. Before starting another product
initiative, review at least 30 complete days from `GET
/api/v1/admin/product-analytics`: save demand, offline restores, 90%-plus
article completions, feed failures, and rolling 7/30-day retention. Record the
decision and the observed baseline in the new initiative's plan. Do not treat
partial launch data as a reason to expand scope. With collection launching on
2026-08-12, the earliest roadmap review is 2026-09-12.

## 2026-07-24 reliability, administration, and diagnostics batch

This third batch was planned against deployed commit `b34c5b9`. It includes
every selected finding from the follow-up review except backup work, which the
operator explicitly excluded. It also turns the three selected product
directions into implementation plans. Use `mise install` once and
`mise exec -- bun ...` for every Bun command.

### Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [022](022-expire-auth-sessions.md) | Enforce absolute and idle expiration for durable auth sessions | P0 | M | - | DONE |
| [023](023-rollback-failed-realtime-subscriptions.md) | Roll back failed realtime subscriptions atomically | P1 | S | - | DONE |
| [024](024-single-web-retry-budget.md) | Give web reads one bounded retry budget | P1 | S | - | DONE |
| [025](025-search-failure-state.md) | Distinguish failed searches from empty results | P1 | S | 024 | DONE |
| [026](026-nonblocking-android-session-store.md) | Remove main-thread blocking from Android session persistence | P1 | M | - | DONE |
| [027](027-open-original-shortcut.md) | Make the web `v` shortcut open the publisher article | P2 | M | - | DONE |
| [028](028-cross-platform-check-command.md) | Add one complete cross-platform quality command | P2 | S | - | DONE |
| [029](029-admin-user-lifecycle.md) | Deliver a safe cross-platform administration console | P1 | L | 022 | DONE |
| [030](030-android-deep-links.md) | Add secure Android article and feed deep links | P2 | M | 026 | DONE |
| [031](031-feed-health-dashboard.md) | Expose actionable feed sync history on web and Android | P2 | L | 023, 024 | DONE |
| [032](032-regression-and-production-deploy.md) | Validate the complete batch and deploy it to production | P0 | L | 022-031 | DONE |

### Dependency and execution notes

- Plans 022, 023, 024, 026, 027, and 028 are independent foundations and may
  be executed in any order on one clean integration branch.
- Plan 025 follows 024 so search tests assert the final three-attempt transport
  budget rather than the old layered six-attempt behavior.
- Plan 029 follows 022 because password reset and user deactivation must revoke
  sessions under the final expiration/cache rules.
- Plan 030 follows 026 so deep-link bootstrap consumes the final non-blocking
  session snapshot rather than creating a second startup path.
- Plan 031 follows 023 and 024 so history refresh uses leak-free realtime and
  the final retry/error-state convention.
- Plan 032 is mandatory and cannot start until every implementation plan is
  DONE. It owns final local verification, browser/emulator smoke checks, exact
  commit review, production push, workflow approval, and post-deploy health.

### Batch-wide rules

- Work from the clean deployed SHA, never from the unrelated dirty checkout.
- Preserve shared-contract-first ordering and API
  `route -> service -> repository` layering.
- Add focused regression tests with every behavior change; do not defer all
  coverage to plan 032.
- Never weaken authorization, ownership, session revocation, URL validation,
  Android encryption, or CI gates to make a test pass.
- Do not push or approve deployment until plan 032 and all of its gates are
  ready.

### Findings considered and rejected

- Scheduled/off-host backup implementation: explicitly excluded by the user
  from this batch. Existing deploy-time backup behavior remains unchanged.
- Wildcard verified Android HTTPS links: rejected because SelfFeed supports
  arbitrary self-hosted domains. Plan 030 uses an explicit custom scheme and
  confirmation boundaries instead of claiming ownership of unknown hosts.
