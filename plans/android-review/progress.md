# Android implementation progress

The implementation starts from `cd802e5`, the current `origin/main` fetched on 2026-09-11. Gustavo authorized separate real PRs for review. PRs remain unmerged. Work takes place in `/tmp/rss-android-experience`; the original checkout is preserved.

## Review stack

| Change | Plan | Branch | PR | State |
| --- | --- | --- | --- | --- |
| Roadmap and execution record | 033–049 | docs/android-experience-roadmap | [#46](https://github.com/Gustav0ar/Self-RSS/pull/46) | Open; CI passed after one test rerun |
| Production-aligned fixtures and isolated verification | 033 | test/android-reader-fixtures | [#48](https://github.com/Gustav0ar/Self-RSS/pull/48) | Open; 420 JVM tests, lint, APK builds, real WebView and process/Room checks passed; physical measurements pending |
| Design alternatives and selection | 034 | design/android-reading-experience | [#47](https://github.com/Gustav0ar/Self-RSS/pull/47) | Open; three mocks prepared, selection pending |
| Session ownership and foreground lifecycle | 035 | fix/android-session-lifecycle | pending | Reconcile existing PR #41 |
| Cache-first reads and mutation authority | 036 | fix/android-cache-mutation-authority | pending | Reconcile existing PRs #38 and #42 |
| Main-safe I/O | 037 | perf/android-main-safe-io | pending | Reconcile existing PR #40 |
| Loading and error lifecycle | 038 | fix/android-loading-lifecycle | pending | Pending |
| Media and renderer lifetime | 039 | fix/android-reader-media-lifecycle | pending | 423 JVM tests, lint/minified build and nine device tests passed; opening PR |
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
