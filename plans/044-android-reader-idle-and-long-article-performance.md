# Plan 044: Stop idle HTML work and bound long-article rendering cost

- Status: TODO
- Priority: P2
- Effort: L
- Implementation risk: HIGH
- Category: perf
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [037](037-android-main-safe-io.md), [039](039-android-media-and-reader-resource-lifecycle.md), [040](040-android-reader-readiness-and-fallback.md), [043](043-android-reading-session-restoration.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderContent.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/articles/ArticleWarmingManager.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt' 'packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderHtmlDocumentTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderTextContentTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/articles/ArticleWarmingManagerTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/ReaderIdleAndLongContentUiTest.kt' 'packages/android/app/src/androidTest/assets/android-review/' 'packages/android/TESTING.md'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Reader height measurement normalizes summary classes while a mutation observer watches those same classes, creating a possible self-triggering loop. Text mode eagerly composes all blocks, and rich mode expands WebView to full article height with a hard cap. Verify idle behavior and choose any renderer change from physical measurements.

## Current state and conventions

Keep non-regressive content, selected-article identity, media lifecycle, cache warming, and restored anchors from prior plans. The five composed pager pages are not a required rendering budget. Main-safe preparation is handled by plan 037. Prefer a focused correction over replacing the reader stack without evidence.

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt:319`:

```kotlin
                function markReaderSummaryBlocks(container) {
                    const summaryLabel = /^(?:tl\s*;?\s*dr|summary|key\s+takeaways?)\b/i;
                    const summaryClass = /(?:tldr|tl-dr|summary|key[-_ ]?takeaways?)/i;
                    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');

                    headings.forEach(heading => {
                        const label = (heading.textContent || '').trim().replace(/\s+/g, ' ');
                        if (!summaryLabel.test(label)) {
                            return;
                        }

                        summaryBlockFor(heading, container)?.classList.add('reader-summary-block');
                    });

                    container.querySelectorAll('aside, section, div, blockquote').forEach(element => {
                        const descriptor = [
                            element.id,
                            element.className,
                            element.getAttribute('data-component'),
                            element.getAttribute('data-testid')
                        ].filter(Boolean).join(' ');
                        if (summaryClass.test(descriptor)) {
                            element.classList.add('reader-summary-block');
                        }
                    });
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt:438`:

```kotlin
                function scheduleReaderUpdate() {
                    // Images can report several intermediate intrinsic sizes.
                    // Wait for layout to settle instead of resizing the native
                    // WebView for every frame, which otherwise flashes its
                    // compositor surface while an article is opening.
                    if (pendingHeightUpdate !== null) {
                        clearTimeout(pendingHeightUpdate);
                    }
                    pendingHeightUpdate = setTimeout(() => {
                        pendingHeightUpdate = null;
                        postHeight();
                    }, 120);
                }

                // Named handlers so they can be removed during cleanup
                function handleLoad() { postHeight(); }
                function handleResize() { postHeight(); }
                function handleDomContentLoaded() { postHeight(); }

                window.addEventListener('load', handleLoad);
                window.addEventListener('resize', handleResize);
                document.addEventListener('DOMContentLoaded', handleDomContentLoaded);

                const resizeObserver = new ResizeObserver(scheduleReaderUpdate);
                resizeObserver.observe(document.body);
                const contentContainer = document.getElementById('content-container');
                if (contentContainer) {
                    resizeObserver.observe(contentContainer);
                }

                const mutationObserver = new MutationObserver(scheduleReaderUpdate);
                if (contentContainer) {
                    mutationObserver.observe(contentContainer, {
                        attributes: true,
                        attributeFilter: ['class', 'style', 'bgcolor', 'color'],
                        childList: true,
                        subtree: true
                    });
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt:78`:

```kotlin
    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag("reader-text-content"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (blocks.isEmpty()) {
            Text(
                text = stringResource(R.string.reader_no_text_content),
                style = paragraphStyle,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        blocks.forEach { block ->
            when (block) {
                is ReaderTextBlock.Heading -> Text(
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:524`:

```kotlin
                addJavascriptInterface(object {
                    @android.webkit.JavascriptInterface
                    fun updateHeight(height: Float) {
                        post {
                            val newHeightDp = height.toInt()
                            // Clamp to a sane range: 0 is "not loaded yet" (the
                            // default 600dp is used), and anything beyond
                            // 50_000dp is almost certainly a measurement bug
                            // (e.g. an element with an unbounded height in the
                            // HTML). Without the upper bound, a runaway value
                            // can produce constraints Compose refuses to
                            // satisfy ("Can't represent a width of 0 and
                            // height of N in Constraints").
                            val clampedDp = newHeightDp.coerceIn(0, 50_000)
                            if (clampedDp > 0 && clampedDp != webViewHeightDp) {
                                webViewHeightDp = clampedDp
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderContent.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/articles/ArticleWarmingManager.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt`
- `packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderHtmlDocumentTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderTextContentTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/articles/ArticleWarmingManagerTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/ReaderIdleAndLongContentUiTest.kt`
- `packages/android/app/src/androidTest/assets/android-review/`
- `packages/android/TESTING.md`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `perf/android-long-article-reader` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| device red | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ReaderIdleAndLongContentUiTest'` | The new test reproduces the named defect on the pre-fix code; after implementation the same test passes. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ReaderIdleAndLongContentUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| benchmark | `bash scripts/android-review-benchmark.sh --serial "$ANDROID_REVIEW_SERIAL" --output packages/android/build/review-performance` | Release-equivalent physical-device results and metadata are written; inspect the predeclared comparison and memory limits. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Execute the real document and detect idle loops

Load the generated reader document in WebView with a summary-containing fixture. Observe normalization/height callbacks after initial settling and after a real image/table/embed resize. Assert callbacks stop while stationary. Source-string assertions or a duplicate JavaScript implementation do not prove this behavior. Add malformed/low-contrast content to check color correction remains bounded.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ReaderIdleAndLongContentUiTest'`. The new test reproduces the named defect on the pre-fix code; after implementation the same test passes.

### 2. Make normalization idempotent and measurement bounded

Only mutate classes/styles when values change. Separate content normalization from geometry reads where possible; suppress self-generated mutations without hiding actual publisher/image changes. Disconnect observers and cancel pending updates when inactive/disposed. Keep bounded initial fallback checks. Avoid full descendant style/geometry scans on every irrelevant mutation.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ReaderIdleAndLongContentUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 3. Compare rendering approaches on long documents

Using the isolated release fixture, measure short/very long text, many images, tables, and embeds for first readable frame, swipe frame timing, heap/native memory, and post-close settling. First tune the number of live renderers independently of cached details. If full-document sizing remains the demonstrated bottleneck, prototype a viewport-sized WebView with one scroll owner and lazy native text blocks in the test target. Compare anchor restoration, selection, links, fullscreen, horizontal tables, and pager gestures before choosing.

Verify with `bash scripts/android-review-benchmark.sh --serial "$ANDROID_REVIEW_SERIAL" --output packages/android/build/review-performance`. Release-equivalent physical-device results and metadata are written; inspect the predeclared comparison and memory limits.

### 4. Implement only the measured improvement

Retain the simpler current renderer where it meets the recorded budgets. Remove silent truncation from the height cap with a tested complete-reading path; do not simply raise the cap. If the prototype wins without behavior regressions, integrate the smallest version and preserve the plan 043 anchor contract. Record rejected alternatives and the measurements, then rerun original journeys.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.ReaderIdleAndLongContentUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

## Test and acceptance contract

- [ ] A stationary summary article reaches idle; a genuine late content resize still updates layout.
- [ ] Inactive/disposed readers do not keep observers or callbacks running.
- [ ] Very long articles remain fully reachable without a hard-height truncation or invalid Compose constraints.
- [ ] Any renderer architecture change has measured physical-device evidence and preserves swipe, selection, media, tables, and restoration.
- [ ] Repeated open/swipe/close memory stabilizes within a recorded budget; no accumulation of live renderers or old Activity instances.
- [ ] Numeric CI timing thresholds remain deferred until stable hardware evidence exists.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- If a proposed renderer rewrite has no measured advantage, keep the focused idle/complete-content fixes and document that decision.
- Do not remove resize observation entirely to make an idle counter pass; images/embeds must still lay out correctly.
- A benchmark on debug/emulator is not sufficient evidence for a physical performance claim.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Keep the real generated-document idle test whenever changing DOM normalization. Maintain independent limits for document data, decoded images, and live renderers.

Reference documentation to verify against the installed versions:

- [Reference 1](https://dom.spec.whatwg.org/#interface-domtokenlist)
- [Reference 2](https://developer.android.com/develop/ui/compose/performance)

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
