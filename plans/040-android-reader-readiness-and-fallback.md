# Plan 040: Show usable reader content without placeholder loops or layout jumps

- Status: TODO
- Priority: P1
- Effort: M
- Implementation risk: MED
- Category: bug
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [034](034-android-design-and-motion-selection.md), [037](037-android-main-safe-io.md), [038](038-android-loading-and-error-lifecycle.md), [039](039-android-media-and-reader-resource-lifecycle.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderContent.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/articles/EnrichmentManager.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/BenchmarkReaderScenario.kt' 'packages/android/app/src/main/res/values/strings.xml' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderContentTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/ArticleReaderPaneNavigationTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/ArticlesViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/articles/EnrichmentManagerTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticleReaderReadinessUiTest.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Rich content can remain pending after a failed fetch even when text is available. The skeleton and WebView are stacked, so removing the skeleton shifts content. The saved htmlReady flag is tied to article state rather than the actual renderer instance, and completion can fire while only a placeholder exists.

## Current state and conventions

Retain non-regressive reader content merging and rich-mode preference across adjacent swipes. Loading state must distinguish cached usable content, pending enhancement, partial text, terminal failure, and rendered readiness. Rich mode should not flicker to Text during a normal fast load; explicit failure may offer the already-available fallback. Visual geometry and copy follow the selected mocks.

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:324`:

```kotlin
        Column(modifier = Modifier.fillMaxWidth()) {
            val html = retainedContent.html
            if (preferHtml && html != null) {
                // Show a skeleton placeholder first so the reader opens
                // instantly. The WebView (which does the HTML load +
                // layout + JS height callback) swaps in once it has a
                // first frame ready. This avoids a blank pane while the
                // article body is rendering.
                var htmlReady by rememberSaveable(article.id) { mutableStateOf(false) }
                if (!htmlReady) {
                    ArticleHtmlSkeleton()
                }
                SecureHtmlContent(
                    html = html,
                    backgroundColor = backgroundColor,
                    textColor = textColor,
                    surfaceColor = surfaceColor,
                    mutedTextColor = mutedTextColor,
                    linkColor = linkColor,
                    appearance = appearance,
                    textScale = textScale,
                    documentBaseUrl = documentBaseUrl,
                    onShowFullscreenMedia = showFullscreenMedia,
                    onHideFullscreenMedia = hideFullscreenMedia,
                    onReady = { htmlReady = true },
                )
            } else if (preferHtml && article.isRichContentPending()) {
                // Keep Rich selected while the next article's detail request
                // completes. Showing the text snapshot here made navigation
                // look like an unwanted mode switch before HTML arrived.
                ArticleHtmlSkeleton(modifier = Modifier.testTag("reader-rich-loading"))
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:228`:

```kotlin
    LaunchedEffect(article.id, isActive, scrollState) {
        if (!isActive) return@LaunchedEffect
        delay(5_000)
        snapshotFlow {
            if (scrollState.maxValue <= 0) 1f
            else scrollState.value.toFloat() / scrollState.maxValue.toFloat()
        }.first { it >= 0.9f }
        onCompleted()
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:553`:

```kotlin
                    override fun onPageFinished(view: WebView?, url: String?) {
                        super.onPageFinished(view, url)
                        view?.evaluateJavascript("window.postHeight && window.postHeight();") { }
                        onReady?.invoke()
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:383`:

```kotlin
private fun ArticleDetail.isRichContentPending(): Boolean =
    contentHtml.isNullOrBlank() &&
        (fetchedAt == null || contentStatus == "enrichment_pending")
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderContent.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/articles/EnrichmentManager.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/BenchmarkReaderScenario.kt`
- `packages/android/app/src/main/res/values/strings.xml`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderContentTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ArticleReaderPaneNavigationTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/ArticlesViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/articles/EnrichmentManagerTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticleReaderReadinessUiTest.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `fix/android-reader-readiness` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| device red | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleReaderReadinessUiTest'` | The new test reproduces the named defect on the pre-fix code; after implementation the same test passes. |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.components.ReaderContentTest' --tests 'com.selffeed.android.ui.components.ArticleReaderPaneNavigationTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.articles.EnrichmentManagerTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleReaderReadinessUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Reproduce failed loading and geometry change

Open a summary-only article, fail detail/enrichment, and assert available text can be reached with retry. Record the reading anchor before/after WebView readiness. Recreate the view for the same article and change content version while rendering is pending. Verify placeholders cannot satisfy article completion or benchmark readiness.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleReaderReadinessUiTest'`. The new test reproduces the named defect on the pre-fix code; after implementation the same test passes.

### 2. Model content availability and failure explicitly

Expose load/enrichment outcomes to the selected reader, keyed by article ID, content version, and reader lifetime. Prefer cached body immediately. Provide the selected partial-text/no-content error states with scoped Retry/Open original where valid. A failed request must leave pending state. Keep existing content visible during revalidation and late non-regressive enrichment. Carry these states and scoped retry actions through SelfFeedAppRoute, SelfFeedApp, and the reader contract; extend the mechanical renderer-loss callback from plan 039 with the selected visible fallback.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.components.ReaderContentTest' --tests 'com.selffeed.android.ui.components.ArticleReaderPaneNavigationTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest' --tests 'com.selffeed.android.ui.articles.EnrichmentManagerTest'`. All selected tests pass.

### 3. Reveal the renderer in a stable region

Overlay placeholder and content in one reserved area; preserve the visible text/scroll anchor as height settles. Use a visual-state callback or equivalent renderer readiness, not merely onPageFinished. Readiness belongs to the actual renderer/document generation and must not be restored true for a newly created blank WebView. Reveal once with the approved finite opacity transition, honoring zero animation scale.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleReaderReadinessUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 4. Gate completion on readable content

Start the reading-completion policy only for the active, foreground, usable body. Placeholder, fetch failure, empty body, and an unrendered WebView must not count as completed after five seconds. Preserve existing auto-mark-read preference semantics separately from completion analytics. Update benchmark readiness to the same body-ready signal.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ArticleReaderReadinessUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

## Test and acceptance contract

- [ ] Offline/failed uncached opens terminate loading and show the available partial text or a useful no-content state.
- [ ] An available cached body never disappears behind a revalidation placeholder.
- [ ] Placeholder removal does not shift the visible reading anchor; recreated views do not inherit stale readiness.
- [ ] Only the current renderer/document can signal ready or completion.
- [ ] Existing non-regressive content and rich/text session-navigation tests pass.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not mark partial/failed content as successfully downloaded or completed.
- Do not remove HTML sanitation, trusted-embed checks, or content-version guards to make rendering succeed.
- If the selected mock does not specify a new fallback/error state, extend that mock and obtain the missing choice before changing visible layout/copy.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Use one readiness signal for reader UI, completion, and benchmarks. Any renderer replacement or document reload must reset readiness for that instance.

Reference documentation to verify against the installed versions:

- [Reference 1](https://developer.android.com/reference/android/webkit/WebView#postVisualStateCallback(long,%20android.webkit.WebView.VisualStateCallback))

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
