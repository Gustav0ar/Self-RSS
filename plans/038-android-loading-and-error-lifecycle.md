# Plan 038: Keep loading continuous and make failures recoverable

- Status: TODO
- Priority: P1
- Effort: L
- Implementation risk: MED
- Category: bug
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [034](034-android-design-and-motion-selection.md), [035](035-android-session-and-request-lifecycle.md), [036](036-android-cache-first-and-mutation-authority.md), [037](037-android-main-safe-io.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/ui/FeedsViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AppWorkflowCoordinator.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticleFeatureEventCoordinator.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/OfflineStatus.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/ArticlePageQuery.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/ArticleRemoteMediator.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt' 'packages/android/app/src/main/res/values/strings.xml' 'packages/android/app/src/test/java/com/selffeed/android/ui/FeedsViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/AppWorkflowCoordinatorTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/ArticleFeatureEventCoordinatorTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/ArticlesViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/OfflineStatusTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidRefreshLifecycleUiTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticlesTabUiTest.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AuthViewModel.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/AuthViewModelTest.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/SettingsViewModelTest.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AppViewModel.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/AppViewModelTest.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/SearchViewModelTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

The user reports the loading animation repeatedly appearing and disappearing. Source shows fresh Paging generations for progressive sync revisions and broad realtime changes, while the foreground indicator reflects each individual load. Empty/error branches and message consumption also make failures confusing. Reproduce the exact sequence, then implement a single coherent operation state.

## Current state and conventions

Keep Paging 3 and Room as the list source of truth. Publisher synchronization can legitimately run longer than a list fetch; do not block reading until every feed succeeds. One explicit refresh owns one stable status through final visible reconciliation. Realtime maintenance must not masquerade as a fresh user refresh. Use the selected loading/error treatment from plan 034. AppResult and PresentationText remain the boundary and localization conventions.

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt:106`:

```kotlin
    val isPagingInitialLoad = pagedArticles.loadState.refresh is LoadState.Loading
    val articleCount = pagedArticles.itemCount

    LaunchedEffect(listState, pagedArticles) {
        snapshotFlow {
            val loadedArticlesById = pagedArticles.itemSnapshotList.items.associateBy { it.id }
            listState.layoutInfo.visibleItemsInfo
                .mapNotNull { item -> loadedArticlesById[item.key as? String] }
                .take(VISIBLE_ARTICLE_PREFETCH_LIMIT)
        }
            .distinctUntilChanged { previous, current ->
                previous.map { it.id } == current.map { it.id }
            }
            .collect(actions.onVisibleArticles)
    }
    // Pull-to-refresh owns only the bounded foreground list reload. Publisher
    // synchronization may continue for slow feeds, but must never capture the
    // pull gesture or leave this spinner running for minutes.
    val isRefreshing = state.isStartingFeedSync || isPagingInitialLoad
    val isEmpty = articleCount == 0 && !isRefreshing
```

`packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt:238`:

```kotlin
        LaunchedEffect(feedsState.syncRevision) {
            workflowCoordinator.onFeedSyncRevisionChanged(feedsState.syncRevision, workflowSink)
        }

        // articleRevision is observed only while this ViewModel is polling a
        // user-initiated sync, so early publisher results can become visible
        // without waiting for the entire background batch.
        LaunchedEffect(feedsState.articleRevision) {
            if (feedsState.articleRevision > 0L && feedsState.syncInBackground) {
                articlesViewModel.refreshArticles()
            }
        }
```

`packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt:277`:

```kotlin
    LaunchedEffect(resolvedErrorMessage) {
        resolvedErrorMessage?.let {
            actions.onClearMessages()
            snackbarHostState.showSnackbar(it)
        }
    }
    LaunchedEffect(resolvedStatusMessage) {
        resolvedStatusMessage?.let {
            actions.onClearMessages()
            snackbarHostState.showSnackbar(
                message = it,
                duration = SnackbarDuration.Short,
            )
        }
```

`packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt:641`:

```kotlin
    private fun refreshArticlePager() {
        articlePagingGeneration += 1
        articlePagingQuery.value =
            _state.value.articleQuery().toArticlePageQuery(articlePagingGeneration)
    }
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/ui/FeedsViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AppWorkflowCoordinator.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticleFeatureEventCoordinator.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/OfflineStatus.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/ArticlePageQuery.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/ArticleRemoteMediator.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt`
- `packages/android/app/src/main/res/values/strings.xml`
- `packages/android/app/src/test/java/com/selffeed/android/ui/FeedsViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/AppWorkflowCoordinatorTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/ArticleFeatureEventCoordinatorTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/ArticlesViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/OfflineStatusTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidRefreshLifecycleUiTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticlesTabUiTest.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AuthViewModel.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/AuthViewModelTest.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/SettingsViewModelTest.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AppViewModel.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/AppViewModelTest.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/SearchViewModelTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `fix/android-loading-lifecycle` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| device red | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidRefreshLifecycleUiTest,com.selffeed.android.ui.ArticlesTabUiTest'` | The new test reproduces the named defect on the pre-fix code; after implementation the same test passes. |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.AppWorkflowCoordinatorTest' --tests 'com.selffeed.android.ui.ArticleFeatureEventCoordinatorTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.components.OfflineStatusTest' --tests 'com.selffeed.android.ui.AuthViewModelTest' --tests 'com.selffeed.android.ui.SettingsViewModelTest' --tests 'com.selffeed.android.ui.AppViewModelTest' --tests 'com.selffeed.android.ui.SearchViewModelTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidRefreshLifecycleUiTest,com.selffeed.android.ui.ArticlesTabUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Reproduce the observed loading sequence

Drive one pull through queued sync, several article revisions, intermediate Paging completion, final server completion, and final Room presentation. Record indicator visibility transitions and operation IDs, including realtime reconnect and hide-read mutations. Assert no idle/loading/idle oscillation within one operation. Also cover cached start, no-cache failure, and cancellation. The review is a lead, so document the actual cause found before changing orchestration.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidRefreshLifecycleUiTest,com.selffeed.android.ui.ArticlesTabUiTest'`. The new test reproduces the named defect on the pre-fix code; after implementation the same test passes.

### 2. Model operation progress and coalesce refresh work

Use an explicit refresh operation identity and finite states for starting, running, reconciling, success/failure. Represent usable content separately from operation progress. Keep one stable progress location until this operation reaches a terminal state, while allowing reading. Coalesce revision events and apply incremental updates without unnecessarily recreating the Pager; when a refresh is necessary preserve the queue and viewport. Unrelated later background events must not restart foreground animation.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.AppWorkflowCoordinatorTest' --tests 'com.selffeed.android.ui.ArticleFeatureEventCoordinatorTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.components.OfflineStatusTest' --tests 'com.selffeed.android.ui.AuthViewModelTest' --tests 'com.selffeed.android.ui.SettingsViewModelTest' --tests 'com.selffeed.android.ui.AppViewModelTest' --tests 'com.selffeed.android.ui.SearchViewModelTest'`. All selected tests pass.

### 3. Make error and message ownership precise

Render one mutually exclusive initial state: loading, content, true empty, or failure without cache. Keep cached rows with scoped retry when refresh fails. Consume only the message being displayed. Replace message-key self-cancellation with a stable event collector or ID-based queue; do not clear every feature's message at once. Assert snackbar visibility for its intended lifetime and no lost independent errors. Update each producer's consumption contract, including Auth, Settings, App, and Search, so acknowledging one message cannot clear a concurrently arriving status/error.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidRefreshLifecycleUiTest,com.selffeed.android.ui.ArticlesTabUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 4. Verify operation completion and idle behavior

Do not hide progress before final visible reconciliation. Do not wait forever for publisher jobs beyond their defined terminal/deadline state. Use the approved static/event-updated treatment for long sync and finite appearance transitions. Test repeated pulls, delayed queue acknowledgement, offline interruption, retry, completed sync while reader open, and resume without duplicate loading.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidRefreshLifecycleUiTest,com.selffeed.android.ui.ArticlesTabUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

## Test and acceptance contract

- [ ] The reproduced loading sequence has one continuous operation status until success/failure; the recording and passing test are linked in execution notes.
- [ ] Cached content stays usable and background events do not restart foreground loading.
- [ ] Initial failure shows retry instead of a caught-up view; retry targets the failed operation.
- [ ] A displayed snackbar survives its intended lifetime and consuming it does not erase other feature messages.
- [ ] No continuous decorative spinner is used for long background synchronization; animations stop at terminal state.
- [ ] The live queue and reader origin/scroll position survive reconciliation.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- If the local fixture does not reproduce the reported symptom, retain the diagnostic evidence and identify the missing trigger before claiming a root-cause fix.
- Do not solve flicker with an arbitrary delay that merely hides idle gaps, or by delaying article display until all publishers finish.
- Do not replace Room/Paging with a second manual article list.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Every new refresh trigger must declare whether it belongs to a user operation or background reconciliation. Keep the operation's terminal state distinct from a single HTTP request finishing.

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
