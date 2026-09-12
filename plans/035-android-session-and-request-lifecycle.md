# Plan 035: End account and reader sessions without accepting stale work

- Status: TODO
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

- [ ] Delayed article success/failure cannot reopen a closed reader or overwrite a newly selected scope.
- [ ] Old-account responses cannot publish state, credentials, replay cursor, or Room/cache entries after the new session starts.
- [ ] Feeds, search, settings, admin data, selected article, and account-scoped work reset on logout/server change.
- [ ] Foreground subscriptions/polling stop while hidden and resume once; durable queued writes remain intact during ordinary backgrounding.
- [ ] Existing auth, offline lease, paging, and fast-swipe tests remain green.
- [ ] An old request cannot dispatch or retry with a replacement account's credentials or replacement server identity; a delayed 401 cannot sign out or authenticate as the new session.
- [ ] A durable owner survives token refresh and process restart, changes at real account/server/session replacement, and is adopted by existing sessions without data loss.
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

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
