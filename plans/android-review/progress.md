# Android implementation progress

The implementation starts from `cd802e5`, the current `origin/main` fetched on 2026-09-11. Gustavo authorized separate real PRs for review. PRs remain unmerged. Work takes place in `/tmp/rss-android-experience`; the original checkout is preserved.

## Review stack

| Change | Plan | Branch | PR | State |
| --- | --- | --- | --- | --- |
| Roadmap and execution record | 033–049 | docs/android-experience-roadmap | [#46](https://github.com/Gustav0ar/Self-RSS/pull/46) | Open; CI passed after one test rerun |
| Production-aligned fixtures and isolated verification | 033 | test/android-reader-fixtures | [#48](https://github.com/Gustav0ar/Self-RSS/pull/48) | Open; 420 JVM tests, lint, APK builds, real WebView and process/Room checks passed; physical measurements pending |
| Design alternatives and selection | 034 | design/android-reading-experience | [#47](https://github.com/Gustav0ar/Self-RSS/pull/47) | Open; three mocks prepared, selection pending |
| Reader request ownership | 035, first slice | fix/android-reader-requests | [#50](https://github.com/Gustav0ar/Self-RSS/pull/50) | Open; CI green, 432 JVM tests, lint, APK builds and four device checks pass |
| Durable session owner | 035, prerequisite | fix/android-session-owner | [#51](https://github.com/Gustav0ar/Self-RSS/pull/51) | Open; 438 JVM tests, lint, both isolated APK pairs and real encrypted-file/process checks pass |
| Owned storage and historical offline retention | 035, storage prerequisite | fix/android-owned-storage | [#52](https://github.com/Gustav0ar/Self-RSS/pull/52) | Open; 451 JVM tests, lint/minified builds, 27 device tests and actual process recovery pass |
| In-flight cache invalidation | 035, cache prerequisite | fix/android-cache-load-lifecycle | pending | 460 JVM tests, lint and isolated APK builds pass; independent source review complete |
| Account ownership and foreground lifecycle | 035, remaining | fix/android-session-lifecycle | pending | Requires data-preserving ownership migration and shared request/commit boundary |
| Cache-first reads and mutation authority | 036 | fix/android-cache-mutation-authority | pending | Reconcile existing PRs #38 and #42 |
| Main-safe I/O | 037 | perf/android-main-safe-io | pending | Reconcile existing PR #40 |
| Loading and error lifecycle | 038 | fix/android-loading-lifecycle | pending | Pending |
| Media and renderer lifetime | 039 | fix/android-reader-media-lifecycle | [#49](https://github.com/Gustav0ar/Self-RSS/pull/49) | Open; CI green, 423 JVM tests, lint/minified build and nine device tests passed |
| Reader readiness and fallback | 040 | fix/android-reader-readiness | pending | Pending |
| Retention metadata and budgets | 041 | perf/android-cache-retention | pending | Pending |
| Durable offline preparation and resource resolver | 042 | feat/android-durable-offline | pending | Pending |
| Reading context restoration | 043 | fix/android-reading-context | pending | Reconcile existing PR #45 |
| Idle and long-article rendering | 044 | perf/android-long-article-reader | pending | Pending |
| Queue and Search UX | 045 | feat/android-queue-search | pending | Reconcile existing PR #43 |
| Adaptive reader and finite motion | 046 | feat/android-adaptive-reader | pending | Pending design selection |
| Drafts, settings and management | 047 | fix/android-editing-resilience | pending | Reconcile existing PRs #39 and #44 |
| Realtime gap recovery | 048 | fix/android-realtime-recovery | pending | Pending |
| Integrated acceptance evidence | 049 | test/android-experience-acceptance | pending | Pending |

Dependencies will use stacked PRs when required. Each PR names its base and the checks for its own change. Source already corrected on main will receive verification and remaining fixes, not a duplicate implementation.

## Environment and evidence

- GitHub authentication works with network access; no open PR existed at reconciliation.
- Isolated SDK/build tools and Gradle are working. The dedicated `small_phone` API 36.1 emulator is booted at `emulator-5566`; normal app packages remain untouched.
- Rich WebView readiness and basic Room/task recovery after actual background process death pass on the dedicated emulator. All 420 JVM tests, lint, both APK pairs and final fixture checks pass. Physical performance and native/WebView memory evidence remain pending.
- `html-communication` is absent. Three local design alternatives and screenshots are in PR #47; Gustavo’s selection and optional private Sites publication reply are pending.
- No production service, user database, daily-driver app, or release channel has been changed.

## Completion rules

- Keep code completion, unit/build results, device results, PR checks, and design selection separate.
- Preserve supported Room histories, including both version-6 layouts. Export/version every persistent schema change and test clean creation plus upgrades.
- Lifecycle tests must cover actual active-page/foreground transitions. Process-death tests need a runner outside the target app.
- Measure release-equivalent performance on identified hardware. A passing build or stable JVM heap does not prove WebView/native memory behavior.
- Final acceptance remains incomplete until all required evidence exists. No claim of zero leaks without the bounded repeated-open/close measurements.

## Execution log

- Reconciled the original review at `74d5c11` with main `cd802e5`. Eight Android PRs landed in between and are mapped above.
- Preserved the original checkout and created an isolated worktree.

- PR #48 Android CI passed all three required jobs. Copilot could not review because its requester quota was exhausted; the independent source review completed and both findings were fixed.
- Plan 039 verified real audio/video pause, fullscreen restoration, renderer-loss recovery after enrichment, bounded views, trim and close on WebView 134.0.6998.135. Physical memory evidence remains pending.

- PR #49 Android instrumentation, JVM tests and lint/build passed. Copilot's quota still prevented its review; independent review findings were reproduced and resolved locally.
- Plan 035 is split into a reader-request PR and the remaining account/foreground work. Two review findings were reproduced and fixed, including a warming cancellation crash. Account transitions need durable queue ownership before replacing the current destructive clear.
- Reader-request slice: `/tmp/android-session-reader-device-final.log` passes Back with delayed detail/read responses, opening another article, latest resume callback and disposal, plus both fast-swipe cases. Tested on dedicated API 36.1 emulator, WebView 134.0.6998.135. `/tmp/android-session-reader-lint-isolated.log` passes lint in a fresh worker after a reused Kotlin lint process crashed; no check was disabled.
- Durable-owner prerequisite: `/tmp/android-session-owner-final-build.log` passes 438 JVM tests and both isolated APK pairs. `/tmp/android-session-owner-lint-final.log`, `/tmp/android-session-owner-device-final.log` and `/tmp/android-session-owner-process-final.log` pass. The independent review's pre-preload authority defect was reproduced in `/tmp/android-session-owner-review-red.log` and fixed; a controlled preload/logout overlap also passes.
- PR #50 completed all Android CI checks on `3a2b070`. Copilot quota remains exhausted; the independent review completed.
- PR #51's first CI run passed lint/build and the new session migrations, but exposed two older test synchronization gaps: checking Room Paging invalidation before its executor callback and injecting a media gesture before Chromium visual readiness. The repository assertion now awaits invalidation; media controls wait for drawing and report actual click/promise outcomes. All 438 JVM tests, lint and eight selected device tests pass in `/tmp/android-session-owner-ci-{build,lint,device-final}.log`; renewed CI remains pending.
- The corrected JVM check passes CI. The next CI emulator run crashed during fullscreen entry and retained no crash diagnostics. The instrumentation job now captures emulator logcat on failure and uploads its test reports. This failure remains unresolved; local success does not replace that evidence.
- PR #51 diagnostic run `34673036348` passed all Android jobs. The next revision also makes media fixture controls fit a narrow reader; 320dp device playback/fullscreen checks pass. The previous crash had no retained stack, so its exact cause remains unknown. The latest revision is still running CI.
- Room 8 preserves existing rows and adds a durable active owner, inactive archived queues and legacy offline pins. Direct 6 → 8 preserves the historical pin table before the unchanged 6 → 7 repair drops it; 7 → 8 adds tables without rewriting existing rows. Both version-6 layouts and every other supported upgrade are verified with populated data on JVM and Android SQLite.
- Storage review reproduced two malformed-body failures, in saved-list and bulk-read reconciliation. Both now preserve raw data while applying metadata updates. Logs: `/tmp/android-owned-storage-{red,review-red,bulk-review-red,verification,device,lint-build}.log`. All 451 JVM tests and 27 device tests pass; the minified build and lint pass. Repository request/commit integration is still pending, so this is not yet an account-isolation completion claim.
- The external process harness also passes on the minified Room 8 build in `/tmp/android-owned-storage-process.log`, retaining its synthetic article, durable session owner and task state after confirmed process death. This does not yet exercise production account transitions across the two stores.
- Cache prerequisite: stale loads after clear, namespace invalidation and newer writes were reproduced, along with an admission race. Atomic registration/publication and reference-counted per-key coordination now pass nine added cases. All 460 JVM tests, lint and isolated APK builds pass in `/tmp/android-cache-load-{build,lint}.log`. Independent review confirmed ticket cleanup and prompted separate gauges for registered keys versus active callers. This fixes cache bookkeeping, not the still-pending repository/account boundary.
