# Plan 035: End account and reader sessions without accepting stale work

- Status: IN PROGRESS; reader request ownership and durable session ID implemented, repository/account storage and foreground boundaries pending
- Priority: P1
- Effort: L
- Implementation risk: MED
- Category: bug
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/ui/AppViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AuthViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/FeedsViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AppWorkflowCoordinator.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ResumeRefreshObserver.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/articles/' 'packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/ArticleRemoteMediator.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/MemoryCache.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/SessionStore.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/' 'packages/android/app/src/main/java/com/selffeed/android/network/NetworkModule.kt' 'packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/' 'packages/android/app/src/test/java/com/selffeed/android/data/' 'packages/android/app/src/test/java/com/selffeed/android/network/NetworkModuleTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidSessionLifecycleUiTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/SessionStoreTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Closing an article does not invalidate an outstanding open request. Logout/server change clears repository storage but leaves feature state and some outstanding writes alive. Introduce clear lifetimes so Back remains final, old accounts cannot repopulate data, and foreground work stops when hidden.

## Current state and conventions

Keep Hilt feature repositories, Room paging, and the stable Navigation 3 detail-session key. RssRepository already uses sessionGeneration for some detail/background requests; extend a single ownership rule instead of adding independent Boolean flags everywhere. Session ownership includes server identity and authenticated user/session, not only article IDs. A ViewModel lifetime is longer than a foreground screen lifetime.

`packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt:269`:

```kotlin
        viewModelScope.launch {
            // The list row already supplied an optimistic reader snapshot.
            // Let Compose commit the navigation transition before starting
            // cache/database/network work for the canonical detail.
            yield()
            if (openRequestId != openArticleSequence.get()) return@launch
            when (val result = repository.article(id, forceRefresh)) {
                is AppResult.Success -> {
                    if (openRequestId != openArticleSequence.get()) return@launch
                    val article = result.data.withReadState(knownArticleReadStates()[id])
                    selectArticle(article)
```

`packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt:340`:

```kotlin
    fun closeArticle() {
        enrichmentManager.cancelEnrichment()
        articleWarmingManager.cancelWarming()
        _state.update {
            it.copy(
                selectedArticle = null,
                readerQueue = emptyList(),
                readerQueueTracksPaging = false,
                readerDetails = emptyMap(),
                visibleReaderArticleId = null,
            )
        }
        enrichmentManager.updateSelectedArticle(null)
        readStateManager.updateSelectedArticle(null)
```

`packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt:105`:

```kotlin
            override fun clearUnauthenticatedSession() {
                articlesViewModel.stopReadStateSync()
                articlesViewModel.clearSessionReadStateMemory()
            }
```

`packages/android/app/src/main/java/com/selffeed/android/data/ArticleRemoteMediator.kt:60`:

```kotlin
    private suspend fun storePage(payload: ApiListResponse<ArticleListItem>, clearExisting: Boolean): MediatorResult {
        localStore.writeArticleRemotePage(queryKey, payload, clearExisting)
        return if (!payload.hasMore || payload.cursor.isNullOrBlank()) {
            completeRefresh()
        } else {
            MediatorResult.Success(endOfPaginationReached = false)
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/ui/AppViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AuthViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/FeedsViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AppWorkflowCoordinator.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ResumeRefreshObserver.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/articles/`
- `packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/ArticleRemoteMediator.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/MemoryCache.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/SessionStore.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/`
- `packages/android/app/src/main/java/com/selffeed/android/network/NetworkModule.kt`
- `packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/`
- `packages/android/app/src/test/java/com/selffeed/android/data/`
- `packages/android/app/src/test/java/com/selffeed/android/network/NetworkModuleTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidSessionLifecycleUiTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/SessionStoreTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/data/SessionOwnerMigrationDeviceTest.kt`
- `packages/android/app/src/performanceTest/java/com/selffeed/android/RecoveryFixtureActivity.kt`
- `packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/AndroidProcessHarnessTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `fix/android-session-lifecycle` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| unit red | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.AppWorkflowCoordinatorTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleRemoteMediatorTest' --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.SessionStoreTest'` | The newly added reproduction fails on the specific pre-fix behavior; after implementation it passes. Existing unrelated tests remain green. |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.AppWorkflowCoordinatorTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleRemoteMediatorTest' --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.SessionStoreTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidSessionLifecycleUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Reproduce stale completion at the real boundaries

Use CompletableDeferred responses to close an optimistic reader before success/failure, change feed scope while detail is pending, and switch accounts/servers while page/feed/preferences/refresh requests are in flight. Cover old search/settings/admin state retained after failed replacement loads. Verify the tests fail on the current behavior before implementation. Add delayed-401 and delayed-dispatch/interceptor cases across account and server changes; assert the old request cannot acquire replacement credentials or be rerouted under replacement server identity.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.AppWorkflowCoordinatorTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleRemoteMediatorTest' --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.SessionStoreTest'`. The newly added reproduction fails on the specific pre-fix behavior; after implementation it passes. Existing unrelated tests remain green.

### 2. Own and invalidate session work

Add a focused cancellable session scope/generation owner or extend the existing owner if sufficient. Every authenticated request that can publish or persist must capture its owner and verify it at the write boundary, including RemoteMediator and token/cookie refresh. Synchronize session transitions with persistence so a check-before-suspension cannot race a subsequent account clear. Reject stale results, including errors that would sign out the new account. Reset all account feature states and replay checkpoints. Fence outgoing dispatch and authentication retries as well as completion. Capture immutable server/session ownership for each logical request, and refuse stale dispatch or retries before attaching credentials. TokenAuthenticator must not retry an old request with the current replacement token, and ApiBaseUrlInterceptor must not rebind old work to a newly selected server. Exercise the real OkHttp interceptor/authenticator boundary, not just repository generation checks. Distinguish the in-memory request generation from a durable non-secret owner identity. Durable ownership must survive process restart and token refresh, but be invalidated by logout, account replacement or server replacement. Do not persist the current AtomicLong counter as identity. Reuse a suitable existing persisted session identifier if available, otherwise introduce a versioned, data-preserving local session-store migration and test adoption of existing sessions without clearing caches or pending work. Plans 042 and 043 use this durable identity.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.AppWorkflowCoordinatorTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleRemoteMediatorTest' --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.SessionStoreTest'`. All selected tests pass.

### 3. Make reader close and scope changes final

Track/cancel the active article-open job and invalidate its sequence on close, scope change, and session reset. Apply the same rule to enrichment/warming callbacks. Keep warm data reuse within the current account. Do not use global cache deletion to solve article navigation. Preserve immediate tap navigation and stable reader destination identity.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.AppWorkflowCoordinatorTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleRemoteMediatorTest' --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.SessionStoreTest'`. All selected tests pass.

### 4. Tie foreground refresh to lifecycle

Use lifecycle-aware effects for UI health polling and realtime subscriptions, with one catch-up/reconciliation on resume. Keep outbox/download WorkManager work independent. Use the latest callback in ResumeRefreshObserver or replace it with the appropriate lifecycle effect. Avoid duplicate startup and resume work. Verify backgrounding stops interactive polling and resuming does not multiply subscriptions.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidSessionLifecycleUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

## Test and acceptance contract

- [x] Delayed article success/failure cannot reopen a closed reader or overwrite a newly selected scope.
- [ ] Old-account responses cannot publish state, credentials, replay cursor, or Room/cache entries after the new session starts.
- [ ] Feeds, search, settings, admin data, selected article, and account-scoped work reset on logout/server change.
- [ ] Foreground subscriptions/polling stop while hidden and resume once; durable queued writes remain intact during ordinary backgrounding.
- [ ] Existing auth, offline lease, paging, and fast-swipe tests remain green.
- [ ] An old request cannot dispatch or retry with a replacement account's credentials or replacement server identity; a delayed 401 cannot sign out or authenticate as the new session.
- [x] A durable owner survives token refresh and process restart, changes at real account/server/session replacement, and is adopted by existing sessions without data loss.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- A network failure is not proof of revoked authentication. Preserve the existing offline-access lease and do not weaken revocation policy.
- Do not delete queued user changes to simplify cancellation. If logout semantics require a new pending-change decision, prepare it for the selected UI workflow rather than silently discarding.
- If a generation check is separated from persistence by suspension, resolve that race before calling the account boundary complete.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Every new account-scoped repository write must join the same owner. Treat server switching, logout, process recreation, and foreground pause as distinct events with distinct cleanup responsibilities.

## Execution notes

- Reconciled commit: `e812051`; existing per-call credential binding from PR #41 is retained. Reader request ownership is a separate first review slice of this plan.
- Reproduction: `/tmp/android-session-reader-red.log` reproduced three delayed detail completion failures. Independent review then reproduced late automatic read rollback reopening Back/feed/next selections and immediate cancellation throwing `ConcurrentModificationException` in `/tmp/android-session-reader-review-red.log`.
- Implementation: cancel and invalidate the detail job on Back, scope/Saved changes and clearing; keep warming initiation in the same job; reject cancelled warming/enrichment callbacks; cancel a snapshot of warming jobs. Read rollback changes only the matching article's read field and preserves current navigation/content. Reader managers are ViewModel-owned Hilt dependencies, eliminating application singleton references to ViewModel scopes and callbacks. ResumeRefreshObserver reads its latest callback.
- Checks: 432 JVM tests pass in `/tmp/android-session-reader-final-build.log`; isolated APK compilation passes. Device/lint evidence recorded in the progress tracker after completion.
- Device evidence for reader slice: all four selected tests pass in `/tmp/android-session-reader-device-final.log` on dedicated API 36.1/WebView 134.0.6998.135. Lint passes in `/tmp/android-session-reader-lint-isolated.log` using a fresh process; earlier reused Kotlin analysis worker crashed. Foreground/account device coverage and physical performance remain pending.
- Design selection: pending where applicable
- Remaining limitations: repository logical request ownership, atomic Room/cache commit fencing, durable account ownership, all-feature logout reset and foreground polling are still pending. No zero-leak or physical performance claim is made by this slice.
- Account-storage dependency found during implementation: current `LocalStore.clearAll()` deletes pending user mutations. The account boundary must first add an explicit Room migration preserving old queues under their previous durable owner and prevent ordinary drains from reading those archived rows. Add `data/local/` and its migration tests to this plan's allowed scope for that prerequisite. Reconcile separate DataStore/Room commits after process death before cache reads or draining. This remains an implementation requirement, not a completed feature.

### Durable owner prerequisite

- Implemented a versioned DataStore 0 → 1 adoption that adds a non-secret owner UUID while preserving existing values. ApiSession checks include the durable owner. Token refresh keeps it; login/register attempts, server replacement and logout rotate it.
- Preload joins the existing session mutation mutex. Uninitialized requests are rejected, and their provisional identity cannot gain authority when existing credentials are loaded. A controlled overlapping preload/logout test covers matching durable and memory state.
- `SessionOwnerMigrationDeviceTest` reopens a legacy-format file containing real AndroidKeyStore ciphertext, checks exact preservation of the previous values, rotates the token, and reopens it again. The external process harness verifies a stable owner and restored credential after actual process death alongside the Room/task fixture.
- This prerequisite does not yet bind Room rows or repository logical retries to that owner. Those remain required before this plan is complete. DataStore schema is version 1; Room remains version 7 until its separate forward migration.
- Owner prerequisite verification: 438 JVM tests, lint and both isolated APK pairs pass. Device migration and external process recovery pass on API 36.1/WebView 134.0.6998.135; logs are `/tmp/android-session-owner-{final-build,lint-final,device-final,process-final}.log`. The owner initialized before preload was rejected after a reproduced independent-review finding. Plan 035 remains incomplete until the account/Room/request and foreground portions land.
- Both historical session paths are exercised on the device: actual `EncryptedSharedPreferences` → owned DataStore, and valid encrypted unversioned DataStore → version 1. Synthetic fixture cleanup is confined to the dedicated device-test package.

### Room ownership prerequisite

- Separate the Room 8 migration and atomic owner-switch storage primitive into `fix/android-owned-storage`; request fencing and integration follow in `fix/android-session-lifecycle`.
- The original 6 → 7 migration drops the historical local offline-retention table. Preserve every old pin, including body-only/orphan/malformed entries, through a registered direct 6 → 8 path before invoking the unchanged published repair. 7 → 8 adds the same tables without rewriting existing rows. Already-lost metadata from a prior 7 upgrade cannot be reconstructed.
- Add `app/schemas/`, `app/src/sharedTest/`, `app/src/androidTest/java/com/selffeed/android/data/local/`, and test source wiring in `app/build.gradle.kts` to the allowed paths. Run one migration/ownership contract on both Robolectric and Android SQLite to avoid divergent fixtures. No production components or UI change is required for this prerequisite.
- Implemented active-owner metadata and archival tables keyed by `(ownerId, articleId)`, preserving multiple blank legacy mutation IDs. Initial adoption keeps the snapshot; replacement archives queued intent, clears active data and updates the owner in one transaction. A failing SQLite trigger proves rollback across all three operations. Archives are excluded from active counts, drains and overlays; reactivation is rejected.
- Legacy pins protect raw bodies from TTL cleanup and ordinary invalidation without projecting them as server bookmarks. Explicit unsave removes only the selected pin. Malformed retained bodies no longer block saved-list or bulk-read reconciliation; both failures were reproduced before their fixes.
- Verification: 451 JVM tests, schema validation and populated upgrades from 1–7 (including both 6 histories), clean creation/reopen, nine ownership/retention tests, lint and minified builds pass. The same storage contracts and media/session checks pass on API 36.1 at 320dp in `/tmp/android-owned-storage-device.log` (27 tests). Request fencing, crash reconciliation between DataStore and Room, and production owner-switch integration remain in the next PR.

### In-flight cache prerequisite

- Separate `fix/android-cache-load-lifecycle` from repository integration. Reproduced loaders repopulating memory after clear/prefix invalidation and overwriting explicit newer values in `/tmp/android-cache-load-red.log`. A further controlled admission race failed in `/tmp/android-cache-admission-red.log` before lookup and load registration were made atomic.
- A short global monitor now protects entries, LRU order and load-ticket admission/publication. Per-key coroutine mutexes coalesce callers without holding the global monitor across network suspension or callbacks. Invalidation revokes old tickets immediately; final cleanup checks ticket identity and reference counts so old callers cannot remove a replacement ticket. Completed, failed and cancelled requests release coordination.
- Nine added cases cover stale publication, admission, failed/cancelled cleanup, non-cooperative cancellation, waiting callers and successful coalescing. Diagnostics distinguish stored entries, registered load keys and still-running/waiting loads. A zero registered-key count after clearing does not imply that all earlier requests finished.
- This cache primitive does not validate explicit future repository writes or prevent an old caller from using its returned response. The shared repository owner/commit boundary remains required.
