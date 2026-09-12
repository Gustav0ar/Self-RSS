# Plan 046: Implement the selected adaptive reader layout and finite motion

- Status: TODO
- Priority: P2
- Effort: L
- Implementation risk: MED
- Category: direction
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [034](034-android-design-and-motion-selection.md), [038](038-android-loading-and-error-lifecycle.md), [039](039-android-media-and-reader-resource-lifecycle.md), [040](040-android-reader-readiness-and-fallback.md), [043](043-android-reading-session-restoration.md), [044](044-android-reader-idle-and-long-article-performance.md), [045](045-android-dense-queue-and-search.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticleListDetailNavigation.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AppNavigationModels.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/OfflineStatus.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/PreferenceOptions.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/theme/Type.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/theme/Theme.kt' 'packages/android/app/src/main/res/values/strings.xml' 'packages/android/app/src/test/java/com/selffeed/android/ui/ArticleListDetailNavigationTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderTextContentTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderHtmlDocumentTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/LocalizedUiSemanticsTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/AdaptiveReaderMotionUiTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticleReaderFastSwipeE2eTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

The reader retains the global five-tab navigation and permanent status chrome, while large-screen back behavior uses a separate raw-width check. Text mode drops interactive links/selection and rich text scaling is capped. Apply the chosen focused layout and motion without destabilizing reader lifecycle or accessibility.

## Current state and conventions

Use the recorded design selection, actual adaptive pane state, stable Navigation 3 reader session, and lifecycle/readiness/anchor contracts from earlier plans. Derive whether Back is needed from the visible pane configuration rather than an unrelated 600dp test. Keep black backgrounds, white primary text, no decorative chrome, and minimal copy. Text mode remains free of embedded media but should preserve meaningful article links and selectable text.

`packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt:610`:

```kotlin
            bottomBar = {
                Column {
                    key(state.auth.user?.id, state.auth.apiBaseUrl) {
                        ArticleSyncStatusLine(state.isOnline, pendingArticleChanges, onRetryPendingChanges)
                    }
                    AppBottomBar(
                        activeTab = activeTab,
                        onTabSelected = actions.onTabSelected,
                    )
                }
```

`packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt:775`:

```kotlin
    val isArticleSelected =
        activeTab in setOf(HomeTab.ARTICLES, HomeTab.SAVED) && selectedArticle != null
    // The Navigation 3 list-detail scene keeps the list visible at this
    // width, so a Back button would be redundant and could incorrectly send
    // a search-origin reader away from its visible context. System Back still
    // follows the Navigation 3 stack.
    val showReaderBack = isArticleSelected && LocalConfiguration.current.screenWidthDp < 600
```

`packages/android/app/src/main/java/com/selffeed/android/ui/ArticleListDetailNavigation.kt:72`:

```kotlin
    val listDetailStrategy = rememberListDetailSceneStrategy<NavKey>()
    NavDisplay(
        backStack = backStack,
        onBack = {
            if (selectedArticleId != null) onCloseArticle()
            else if (backStack.size > 1) backStack.removeLastOrNull()
        },
        sceneStrategies = listOf(listDetailStrategy),
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt:24`:

```kotlin
/** A distraction-free, media-free representation of an article. */
internal sealed interface ReaderTextBlock {
    val text: String

    data class Heading(override val text: String) : ReaderTextBlock

    data class Paragraph(override val text: String) : ReaderTextBlock

    data class Bullet(override val text: String) : ReaderTextBlock
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt:43`:

```kotlin
    val safeHtml = sanitizeReaderHtml(html)
    val textSizePx = (appearance.boundedTextSizeSp * textScale).toInt().coerceIn(12, 32)
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticleListDetailNavigation.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AppNavigationModels.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/OfflineStatus.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/PreferenceOptions.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/theme/Type.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/theme/Theme.kt`
- `packages/android/app/src/main/res/values/strings.xml`
- `packages/android/app/src/test/java/com/selffeed/android/ui/ArticleListDetailNavigationTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderTextContentTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderHtmlDocumentTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/LocalizedUiSemanticsTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/AdaptiveReaderMotionUiTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticleReaderFastSwipeE2eTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `feat/android-adaptive-reader` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AdaptiveReaderMotionUiTest,com.selffeed.android.ui.ArticleReaderFastSwipeE2eTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.ArticleListDetailNavigationTest' --tests 'com.selffeed.android.ui.components.ReaderTextContentTest' --tests 'com.selffeed.android.ui.components.ReaderHtmlDocumentTest' --tests 'com.selffeed.android.ui.LocalizedUiSemanticsTest'` | All selected tests pass. |
| benchmark | `bash scripts/android-review-benchmark.sh --serial "$ANDROID_REVIEW_SERIAL" --output packages/android/build/review-performance` | Release-equivalent physical-device results and metadata are written; inspect the predeclared comparison and memory limits. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Implement the selected focused and adaptive shell

Use the chosen phone reader controls and tablet list/detail layout. Keep saved/search origins, navigation gestures, status visibility, and accessible back paths consistent with actual pane state. Check insets, keyboard, fullscreen media, fold/unfold, and resizing. Reveal relevant pending/offline/failure status without permanently consuming reading space unless selected in the mock.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AdaptiveReaderMotionUiTest,com.selffeed.android.ui.ArticleReaderFastSwipeE2eTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 2. Preserve reader text interaction and scale

Render selectable text and safe clickable article links in Text mode while continuing to exclude media. Preserve headings and lists for accessibility. Honor system font scaling consistently in native and rich content; remove arbitrary scaling caps that prevent requested accessibility sizes, replacing them with responsive wrapping and readable line length. Keep external navigation through existing URL validation.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.ArticleListDetailNavigationTest' --tests 'com.selffeed.android.ui.components.ReaderTextContentTest' --tests 'com.selffeed.android.ui.components.ReaderHtmlDocumentTest' --tests 'com.selffeed.android.ui.LocalizedUiSemanticsTest'`. All selected tests pass.

### 3. Apply finite motion to meaningful transitions

Implement only selected motions: reader open/close, gesture-driven pager, and body reveal. Plan 045 owns row-placement and read/save acknowledgement motion; plan 047 owns category expansion in feed management. Suggested 100–200ms values are starting points, not mandatory constants. Make transitions interruptible, preserve focus/anchors, and respect system duration scale including zero. Long sync uses stable event-updated progress; idle reading schedules no app-controlled repeating animation.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AdaptiveReaderMotionUiTest,com.selffeed.android.ui.ArticleReaderFastSwipeE2eTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 4. Verify motion with the final data/lifecycle model

Test rapid alternating actions, Back during transition, a failed fetch during entry, live read-state changes, reduced/disabled motion, 200% text, keyboard and TalkBack. Record 60/120Hz physical-device frames where available using the isolated performance target. Ensure motion does not reinstantiate WebViews or trigger playback, and no frame-time improvement claim relies on debug runs.

Verify with `bash scripts/android-review-benchmark.sh --serial "$ANDROID_REVIEW_SERIAL" --output packages/android/build/review-performance`. Release-equivalent physical-device results and metadata are written; inspect the predeclared comparison and memory limits.

## Test and acceptance contract

- [ ] Selected phone/tablet layouts match the recorded mock decisions across the viewport matrix.
- [ ] Back and reader actions stay reachable in every actual pane arrangement; Search/Saved origin is preserved.
- [ ] Text mode has selectable/link-aware content and both renderers honor large system text.
- [ ] Finite transitions stop when idle and remain correct when interrupted or disabled.
- [ ] Media lifecycle, offline rendering, readiness, and restored anchors remain correct under the new layout.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- If the chosen design needs an amendment, update the mock and record the decision before changing real components.
- Do not implement custom predictive-back behavior that competes with Navigation 3 without testing the actual system gesture.
- Do not use shimmer, pulse, indefinite rotation, or repeated blur as decoration.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Treat motion as part of state transitions, not as a separate timer loop. New breakpoints must derive from the same adaptive information used by navigation.

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
