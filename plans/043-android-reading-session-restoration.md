# Plan 043: Restore reading context after process recreation

- Status: TODO
- Priority: P2
- Effort: M
- Implementation risk: MED
- Category: bug
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [035](035-android-session-and-request-lifecycle.md), [040](040-android-reader-readiness-and-fallback.md), [042](042-android-durable-offline-downloads.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/ui/AppViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AppNavigationModels.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticleListDetailNavigation.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/SessionStore.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/AppViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/ArticlesViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/SearchViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/ArticleListDetailNavigationTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/ReadingSessionRestorationUiTest.kt' 'scripts/android-review-process.sh' 'packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/ReadingSessionProcessTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Selected article, tab, feed/category, and search query currently live in ordinary ViewModels. Compose saves some scroll state, but it cannot restore a missing article selection after process death. Preserve enough context to reconstruct the reading session from Room without serializing large documents or autoplaying media.

## Current state and conventions

Use SavedStateHandle/saveable primitives for small navigation state and the persistent local store for content. The stable detail destination represents the reading session, not a separate entry for each article. Preserve Search-origin back behavior and rich/text choice according to its existing session lifetime. Never restore an account/server's state into another account. Match plan 035's durable owner identity across process/token recreation; reject state from an invalidated owner, not merely a different in-memory generation value.

`packages/android/app/src/main/java/com/selffeed/android/ui/AppViewModel.kt:26`:

```kotlin
data class AppChromeState(
    val activeTab: HomeTab = HomeTab.ARTICLES,
    val readerOrigin: HomeTab = HomeTab.ARTICLES,
    val isOnline: Boolean = true,
    val isSyncingFeeds: Boolean = false,
    val globalStatus: PresentationText? = null,
    val globalError: PresentationText? = null,
    val sessionReady: Boolean = false,
    val pendingExternalAction: ExternalAction? = null,
    val serverChangeConfirmation: ExternalAction.OpenArticle? = null,
)

@HiltViewModel
class AppViewModel @Inject constructor(
    private val repository: AppStatusRepository,
    private val sessionStore: SessionStore,
) : ViewModel() {
    private val _chrome = MutableStateFlow(AppChromeState())
    val chrome: StateFlow<AppChromeState> = _chrome.asStateFlow()
```

`packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt:33`:

```kotlin
data class ArticlesUiState(
    val items: List<ArticleListItem> = emptyList(),
    val readerQueue: List<ArticleListItem> = emptyList(),
    val readerQueueTracksPaging: Boolean = false,
    val readerDetails: Map<String, ArticleDetail> = emptyMap(),
    val visibleReaderArticleId: String? = null,
    val selectedArticle: ArticleDetail? = null,
    val selectedFeedId: String? = null,
    val selectedCategoryId: String? = null,
    val savedOnly: Boolean = false,
    val loading: Boolean = false,
    val sort: String? = null,
    val hideRead: Boolean = false,
    val autoMarkReadMode: AutoMarkReadPreference = AutoMarkReadPreference.ON_NAVIGATE,
    val statusMessage: PresentationText? = null,
    val errorMessage: PresentationText? = null,
)
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:218`:

```kotlin
    val scrollState = rememberSaveable(article.id, saver = ScrollState.Saver) {
        ScrollState(initial = 0)
    }
    var fullscreenMedia by remember { mutableStateOf<FullscreenMediaView?>(null) }
    val documentBaseUrl = readerDocumentBaseUrl(article.canonicalUrl, article.feedSiteUrl)

    LaunchedEffect(article.id, isActive) {
        if (isActive) onDisplayed()
```

`packages/android/app/src/main/java/com/selffeed/android/ui/ArticleListDetailNavigation.kt:50`:

```kotlin
    val backStack = rememberNavBackStack(ArticleListDestination)
    // The detail entry represents the whole reader session, not one article.
    // Keeping this destination stable is essential: replacing its key after a
    // pager swipe disposes the pager and its WebViews, producing a visible
    // one-frame flash after the swipe has already settled.
    val isReaderOpen = selectedArticleId != null
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/ui/AppViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AppNavigationModels.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticleListDetailNavigation.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/SessionStore.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/AppViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/ArticlesViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/SearchViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/ArticleListDetailNavigationTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/ReadingSessionRestorationUiTest.kt`
- `scripts/android-review-process.sh`
- `packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/ReadingSessionProcessTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `feat/android-reading-restoration` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.AppViewModelTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.SearchViewModelTest' --tests 'com.selffeed.android.ui.ArticleListDetailNavigationTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ReadingSessionRestorationUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| process | `bash scripts/android-review-process.sh 'com.selffeed.android.macrobenchmark.ReadingSessionProcessTest'` | The separately hosted test runner survives target death; all selected recovery journeys pass with verified old/new target PIDs and persisted state. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Define the minimal saved context

Save account/server owner, active tab, reader origin, article ID, selected scope, saved/offline filter, query and search scope, and a compact reading anchor. Store list article key plus offset rather than a full Paging snapshot. Define an article-content anchor with a bounded offset/progress fallback when content version changes. Do not store HTML, bitmaps, WebViews, players, or access tokens in state bundles.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.AppViewModelTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.SearchViewModelTest' --tests 'com.selffeed.android.ui.ArticleListDetailNavigationTest'`. All selected tests pass.

### 2. Restore after session and local data readiness

Initialize ViewModels from SavedStateHandle, validate ownership, then reopen through the cache-first repository. Reconstruct navigation once, avoiding duplicate detail entries or stale open requests. Handle missing/deleted article and unavailable body by returning to the saved origin with the established recovery state. Ordinary offline restoration still obeys the existing lease.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.AppViewModelTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.SearchViewModelTest' --tests 'com.selffeed.android.ui.ArticleListDetailNavigationTest'`. All selected tests pass.

### 3. Restore position when layout is ready

Apply the anchor after the current renderer signals usable layout, clamp it to valid bounds, and preserve it through rich/text mode changes where feasible. Rotation/window resizing must preserve context. Resume reading, not playback; require a user gesture to play media again.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ReadingSessionRestorationUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 4. Verify real process restoration separately from rotation

Use ActivityScenario recreation for configuration behavior and a dedicated process-death/relaunch scenario for saved-state restoration. The process test must use a stopped test task/system-kill-style sequence, not assume force-stop guarantees Android saved-state restoration. Keep all state inside the isolated test app. Test account switch, deleted article, changed content height, empty cache, and Search-origin back. Implement this case in the separate-process UiAutomator harness from plan 033: establish UI state, background and wait for saved state, kill the background target process, assert its PID is gone and the runner survives, resume the existing task, verify a new PID and restored article/query/anchor. Use real Room with controlled local transport. AndroidJUnitRunner hosted in the killed application cannot prove these phases.

Verify with `bash scripts/android-review-process.sh 'com.selffeed.android.macrobenchmark.ReadingSessionProcessTest'`. The separately hosted test runner survives target death; all selected recovery journeys pass with verified old/new target PIDs and persisted state.

## Test and acceptance contract

- [ ] System recreation restores the same account-scoped article, origin, filter, query, and usable reading anchor.
- [ ] Recreated views wait for current layout readiness; restoration does not cause a loading loop or duplicate navigation.
- [ ] Deleted/unavailable articles recover to a usable origin instead of a blank reader.
- [ ] Saved-state payloads contain small identifiers/anchors only.
- [ ] Media remains paused after restoration and account changes invalidate saved context.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not persist full article lists/content in Bundle or SavedStateHandle to simulate a cache.
- Do not claim process-death support from ActivityScenario.recreate alone.
- Persistent resume-after-explicit-app-dismissal is a different promise; if added, use a versioned local schema/migration and record the policy rather than assuming SavedStateHandle covers it.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Every new navigation/filter field needs an explicit restoration and account-ownership decision. Anchors must tolerate content enrichment and font/viewport changes.

Reference documentation to verify against the installed versions:

- [Reference 1](https://developer.android.com/topic/libraries/architecture/saving-states)

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
