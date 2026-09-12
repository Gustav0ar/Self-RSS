# Plan 039: Pause inactive media and release reader resources predictably

- Status: IMPLEMENTED (device verified; account integration and physical memory evidence pending)
- Priority: P1
- Effort: L
- Implementation risk: MED
- Category: bug
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [035](035-android-session-and-request-lifecycle.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderDialog.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticleListDetailNavigation.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/articles/ArticleWarmingManager.kt' 'packages/android/app/src/main/java/com/selffeed/android/MainActivity.kt' 'packages/android/app/src/main/java/com/selffeed/android/SelfFeedApplication.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/ArticleReaderPaneNavigationTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/ArticleListDetailNavigationTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticleMediaLifecycleUiTest.kt' 'packages/android/app/src/androidTest/assets/android-review/'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

The pager retains two pages on each side, but isActive only gates display/completion callbacks. The WebView does not receive visibility or foreground state and allows gesture-free media playback. Disposal exists, but navigation between retained pages does not pause their work.

## Current state and conventions

Preserve adjacent article-data warming and stable Navigation 3 reader identity. Separate cached ArticleDetail data from live WebViews and media players. At most the visible primary reader in a foreground window may play media. A selectedArticle ID can lag a swipe while detail loads, so activity must follow actual pager visibility rather than only a network-selected ID. WebView.onPause does not pause JavaScript; pauseTimers affects all WebViews.

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:170`:

```kotlin
    HorizontalPager(
        state = pagerState,
        modifier = Modifier.fillMaxSize(),
        beyondViewportPageCount = 2,
        key = { page -> readerArticles[page].id },
    ) { page ->
        if (readerArticles.isEmpty()) return@HorizontalPager
        val articleItem = readerArticles[page]
        val article = selectedDetails[articleItem.id]
        if (article != null) {
            ArticleDetailView(
                observeOfflineText = observeOfflineText,
                article = article,
                isActive = articleItem.id == selectedArticle.id,
                onOpenOriginal = { onOpenOriginal(article) },
                onDisplayed = { onArticleDisplayed(article.id) },
                onCompleted = { onArticleCompleted(article.id) },
                preferHtml = preferHtml,
                onPreferHtmlChanged = onPreferHtmlChanged,
                appearance = appearance,
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:506`:

```kotlin
            WebView(factoryContext).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.domStorageEnabled = true
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                settings.mediaPlaybackRequiresUserGesture = false

                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = true
                setBackgroundColor(backgroundColor.toArgb())
                webChromeClient = readerWebChromeClient(
                    onShowFullscreenMedia = onShowFullscreenMedia,
                    onHideFullscreenMedia = onHideFullscreenMedia,
                )
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:574`:

```kotlin
        onRelease = { webView ->
            webView.releaseReaderResources()
        },
    )
}

internal fun WebView.releaseReaderResources() {
    runCatching {
        stopLoading()
        // Call cleanup function to remove event listeners and disconnect observers
        evaluateJavascript("if (window.SelfFeedApp && typeof window.SelfFeedApp.cleanup === 'function') { window.SelfFeedApp.cleanup(); }", null)
        loadUrl("about:blank")
        removeJavascriptInterface("Android")
        webChromeClient = WebChromeClient()
        webViewClient = WebViewClient()
        destroy()
    }
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderDialog.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticleListDetailNavigation.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/articles/ArticleWarmingManager.kt`
- `packages/android/app/src/main/java/com/selffeed/android/MainActivity.kt`
- `packages/android/app/src/main/java/com/selffeed/android/SelfFeedApplication.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ArticleReaderPaneNavigationTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/ArticleListDetailNavigationTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticleMediaLifecycleUiTest.kt`
- `packages/android/app/src/androidTest/assets/android-review/`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderWebView.kt` for one renderer resource owner.
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt` for immediate tab visibility.
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderWebViewTest.kt` for failure-safe disposal.
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderHtmlDocumentTest.kt` for the changed observer callback.
- `plans/android-review/progress.md` for tracking.
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `fix/android-reader-media-lifecycle` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| device red | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleMediaLifecycleUiTest'` | The new test reproduces the named defect on the pre-fix code; after implementation the same test passes. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleMediaLifecycleUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.components.ArticleReaderPaneNavigationTest' --tests 'com.selffeed.android.ui.ArticleListDetailNavigationTest'` | All selected tests pass. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Reproduce playback after navigation

Use actual WebView HTML5 media with a local media fixture. Play A, swipe to B, move to another tab, background, exit fullscreen, and close. Observe real playback state and per-page activity through test-scoped hooks; do not assert only a mocked pause method call. Add a case where selectedArticle updates late.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleMediaLifecycleUiTest'`. The new test reproduces the named defect on the pre-fix code; after implementation the same test passes.

### 2. Implement a per-reader active lifecycle

Propagate foreground and primary-page visibility to the live renderer. Pause HTML5 audio/video explicitly and handle supported trusted iframe providers using their documented APIs; detach unsupported live embeds when inactive. Pause view work per WebView. Require user gesture for new playback and do not automatically resume old media on return or process restoration. Do not use global pauseTimers to pause a sibling.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleMediaLifecycleUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 3. Release views and callbacks at the correct boundary

Pause before leaving the active page. On actual eviction/close/session end stop loading, detach fullscreen content, call its callback once, remove bridges/listeners, cancel pending callbacks, blank and destroy the view. Keep cleanup idempotent and ensure one cleanup failure cannot skip destroy. Never retain Activity-backed WebViews in singleton caches. Handle onRenderProcessGone by removing each affected view, invalidating readiness for that instance, and recreating the renderer from retained content with a bounded retry policy. Define the mechanical renderer-failure callback/state here without changing visible layout or copy; plan 040 consumes it for the selected visible failure/retry treatment. Do not depend on plan 040 or create an automatic crash/recreate loop.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleMediaLifecycleUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 4. Bound live renderers independently of data warming

Choose a small measured live-renderer window while retaining nearby article data. Respond to memory pressure by releasing inactive renderers and disposable detail data, not saved content or the outbox. Verify reopening creates a fresh healthy renderer and restores the reading anchor once plan 043 lands. Keep budget counters/test hooks out of production UI.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.components.ArticleReaderPaneNavigationTest' --tests 'com.selffeed.android.ui.ArticleListDetailNavigationTest'`. All selected tests pass.

## Test and acceptance contract

- [x] A loses playback permission as soon as B becomes primary, even if B's detail fetch is delayed.
- [ ] Background, tab switch, reader close, and account switch pause all reader media; returning does not autoplay.
- [x] Fullscreen views and callbacks release exactly once; late callbacks cannot mutate a destroyed renderer.
- [ ] Repeated open/swipe/close cycles do not monotonically grow live renderer count or retain old Activity instances.
- [x] Renderer-process loss is recoverable without crashing the app or clearing persistent data.
- [x] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [x] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [x] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Cross-origin embedded players cannot be paused by querying their DOM. Use a provider API or detach the embed; do not weaken origin checks.
- If a media provider requires real network validation, use a synthetic test page and record the separate provider check; never use a user's browsing session.
- Do not destroy the active reader on every recomposition or ordinary read-state update.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Every future embedded provider must implement the same pause/dispose contract. Keep lifecycle ownership centralized and derive active status from actual visibility plus foreground state.

Reference documentation to verify against the installed versions:

- [Reference 1](https://developer.android.com/reference/android/webkit/WebView#onPause())
- [Reference 2](https://developer.android.com/reference/android/webkit/WebViewClient#onRenderProcessGone(android.webkit.WebView,%20android.webkit.RenderProcessGoneDetail))

## Execution notes

- Based on foundation `6a88a72`, PR #48. The visible page and Activity lifecycle are available independently of plan 035, so media ownership lands first. The account-switch integration remains in 035. No selected visual design or new copy was implemented.
- Reproduced the original bug with real local WAV playback. After swiping A to B while holding selectedArticle at A, the native test timed out waiting for the HTML5 element to pause. `/tmp/android-media-red.log` records that failure.
- A single Activity-bound ReaderWebView now owns document bridges, queued height callbacks, current fullscreen media and disposal. It uses the primary pager page plus RESUMED state, pauses audio/video, requires a fresh gesture, and blanks cross-origin frames when inactive. Returning reloads an iframe with autoplay disabled; provider playback position is not preserved. This unload policy avoids relying on an unacknowledged provider pause message or accessing a cross-origin DOM.
- The renderer window is bounded to the current page and one adjacent page each side. An actual Android memory-trim signal releases adjacent renderers. Data warming remains separate. Closing or switching to Text releases the views without deleting persisted content.
- A renderer crash releases the affected view and permits one replacement per document. A second crash shows retained text. Crash recovery after a live enrichment update is covered, including current callbacks after remembered document state changes.
- Fullscreen disposal is idempotent, releases its callback and view, and restores orientation. Cleanup failures cannot skip native destroy. A callback that immediately rejects fullscreen does not retain the closed owner.
- Validation passed: all 423 JVM tests, deviceTest lint, minified benchmarkPerformanceTest build, and nine device checks covering real audio/video navigation, background, hidden tab, Text mode, fullscreen, two Chromium crashes after enrichment, eight-page renderer bounds, memory trim, close, rich readiness and existing fast swipes. The separate reviewer rechecked both reported defects after their fixes and found neither remained.
- Device: dedicated small_phone, API 36.1, 720×1280, density 320, SwiftShader, Google WebView 134.0.6998.135. No normal app or user data was touched.
- Evidence: `/tmp/android-media-verification.log`, `/tmp/android-media-regression.log`, `/tmp/android-media-device-final.log`, and standard Gradle XML/HTML reports. The pre-fix failure is in `/tmp/android-media-red.log`.
- Remaining acceptance: plan 035 verifies complete account/server transitions; plan 040 owns user-facing failure/loading treatment; plan 044 owns idle/layout cost; plan 049 measures native/WebView memory on physical hardware. A bounded number of live views does not prove absence of every native or Activity leak.
