# Android implementation progress

The implementation starts from `cd802e5`, the current `origin/main` fetched on 2026-09-11. Gustavo authorized separate real PRs for review. PRs remain unmerged. Work takes place in `/tmp/rss-android-experience`; the original checkout is preserved.

## Review stack

| Change | Plan | Branch | PR | State |
| --- | --- | --- | --- | --- |
| Roadmap and execution record | 033–049 | docs/android-experience-roadmap | pending | Preparing |
| Production-aligned fixtures and isolated verification | 033 | test/android-reader-fixtures | pending | In progress |
| Design alternatives and selection | 034 | design/android-reading-experience | pending | Preparing mocks |
| Session ownership and foreground lifecycle | 035 | fix/android-session-lifecycle | pending | Reconcile existing PR #41 |
| Cache-first reads and mutation authority | 036 | fix/android-cache-mutation-authority | pending | Reconcile existing PRs #38 and #42 |
| Main-safe I/O | 037 | perf/android-main-safe-io | pending | Reconcile existing PR #40 |
| Loading and error lifecycle | 038 | fix/android-loading-lifecycle | pending | Pending |
| Media and renderer lifetime | 039 | fix/android-reader-media-lifecycle | pending | Pending |
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
- API 37 platform and API 35 emulator image installation are in progress. Platform-tools are installed.
- No physical device or accelerated emulator has been verified. Physical performance, native/WebView memory, and actual process-death evidence are pending.
- `html-communication` is absent from installed skills. Prepare local design alternatives before requesting the required publishing fallback and design selection.
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
