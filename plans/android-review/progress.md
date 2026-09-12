# Android implementation progress

The implementation starts from `cd802e5`, the current `origin/main` fetched on 2026-09-11. Gustavo authorized separate real PRs for review. PRs remain unmerged. Work takes place in `/tmp/rss-android-experience`; the original checkout is preserved.

## Review stack

| Change | Plan | Branch | PR | State |
| --- | --- | --- | --- | --- |
| Roadmap and execution record | 033–049 | docs/android-experience-roadmap | [#46](https://github.com/Gustav0ar/Self-RSS/pull/46) | Open; CI passed after one test rerun |
| Production-aligned fixtures and isolated verification | 033 | test/android-reader-fixtures | [#48](https://github.com/Gustav0ar/Self-RSS/pull/48) | Open; 420 JVM tests, lint, APK builds, real WebView and process/Room checks passed; physical measurements pending |
| Design alternatives and selection | 034 | design/android-reading-experience | [#47](https://github.com/Gustav0ar/Self-RSS/pull/47) | Open; three mocks prepared, selection pending |
| Reader request ownership | 035, first slice | fix/android-reader-requests | [#50](https://github.com/Gustav0ar/Self-RSS/pull/50) | Open; CI green, 432 JVM tests, lint, APK builds and four device checks pass |
| Durable session owner | 035, prerequisite | fix/android-session-owner | pending | 438 JVM tests, lint, both isolated APK pairs and real encrypted-file/process checks pass; opening PR |
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
