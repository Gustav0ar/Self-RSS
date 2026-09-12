# Plan 045: Make article queues and search dense, truthful, and accessible

- Status: TODO
- Priority: P2
- Effort: L
- Implementation risk: MED
- Category: direction
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [034](034-android-design-and-motion-selection.md), [038](038-android-loading-and-error-lifecycle.md), [042](042-android-durable-offline-downloads.md), [043](043-android-reading-session-restoration.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/SearchTab.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/PreferenceOptions.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/OfflineStatus.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/theme/Color.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/theme/Type.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt' 'packages/android/app/src/main/res/values/strings.xml' 'packages/android/app/src/test/java/com/selffeed/android/ui/SearchViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/PreferenceOptionsTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/LocalizedUiSemanticsTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticlesTabUiTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/QueueSearchAccessibilityUiTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Compact density changes spacing and thumbnail size but still reserves multiple metadata lines, excerpts, offline subtitles, and a separate bookmark. Search adds padding and ignores density; it can label old results with a new query while hiding loading. Read-state opacity also makes read articles hard to scan.

## Current state and conventions

Implement the direction selected in plan 034. Preserve Paging/Room list authority, origin-preserving reader navigation, saved/offline filters from plan 042, and restoration from plan 043. Theme uses true black but read rows currently fade the entire row to 0.6. Material hit-target expansion must be verified in the actual semantics tree; a small visual icon alone does not prove a small touch target.

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt:619`:

```kotlin
    val isRead = isReadOverride ?: article.isRead
    val verticalPadding = if (density == DensityPreference.COMPACT) 8.dp else 12.dp
    val heroSize = if (density == DensityPreference.COMPACT) 44.dp else 56.dp
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else MaterialTheme.colorScheme.background,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(if (isRead && !selected) 0.6f else 1f)
                .padding(horizontal = 16.dp, vertical = verticalPadding),
```

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt:665`:

```kotlin
                    Text(
                        text = formatPublishedAt(article.displayedAt ?: article.publishedAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.padding(start = if (isRead) 0.dp else 14.dp),
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = article.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (isRead) FontWeight.Normal else FontWeight.SemiBold,
                    color = if (isRead && !selected) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    maxLines = if (density == DensityPreference.COMPACT) 2 else 3,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = MaterialTheme.typography.titleMedium.lineHeight * 0.9f,
                )
                OfflineTextStatus(article.id, observeOfflineText)
                article.excerpt?.takeIf { it.isNotBlank() }?.let {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                        maxLines = if (density == DensityPreference.COMPACT) 1 else 2,
                        overflow = TextOverflow.Ellipsis,
```

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/SearchTab.kt:85`:

```kotlin
        item {
            if (state.query.length >= 2) {
                Text(
                    text = pluralStringResource(
                        R.plurals.search_result_count,
                        state.results.size,
                        state.results.size,
                    ),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }

        if (state.loadingResults && state.results.isEmpty()) {
            item(key = "search-loading") {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
```

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/SearchTab.kt:117`:

```kotlin
        ) { article ->
            Column(modifier = Modifier.clickable { actions.onOpenArticle(article.id) }) {
                ArticleCard(
                    observeOfflineText = observeOfflineText,
                    article = article,
                    selected = state.selectedArticleId == article.id,
                    onClick = {},
                onToggleSaved = { actions.onToggleSaved(article.id, !article.isSaved) },
                )
```

`packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt:74`:

```kotlin
        _state.update {
            it.copy(
                cursor = null,
                hasMore = false,
                loading = true,
                loadingMore = false,
                errorMessage = null,
                resultLimitReached = false,
            )
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/SearchTab.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/PreferenceOptions.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/OfflineStatus.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/theme/Color.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/theme/Type.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt`
- `packages/android/app/src/main/res/values/strings.xml`
- `packages/android/app/src/test/java/com/selffeed/android/ui/SearchViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/PreferenceOptionsTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/LocalizedUiSemanticsTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticlesTabUiTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/QueueSearchAccessibilityUiTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `feat/android-reading-queue` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.SearchViewModelTest' --tests 'com.selffeed.android.ui.PreferenceOptionsTest' --tests 'com.selffeed.android.ui.LocalizedUiSemanticsTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.QueueSearchAccessibilityUiTest,com.selffeed.android.ui.ArticlesTabUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Make displayed search results belong to a completed query

Track the query/scope associated with displayed results separately from editing input. Cancel/ignore stale requests and expose updating, failure/retry, no results, and cached/offline scope. Preserve old results only with truthful labeling. Query local cache directly when offline, preserving the distinction between no local match and no server match. Keep pagination tied to the completed query generation.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.SearchViewModelTest' --tests 'com.selffeed.android.ui.PreferenceOptionsTest' --tests 'com.selffeed.android.ui.LocalizedUiSemanticsTest'`. All selected tests pass.

### 2. Implement the selected shared row layout

Use the approved metadata/title/excerpt/image hierarchy in both main queue and Search. Apply density consistently and remove redundant outer padding. Keep offline state accessible using the chosen compact treatment. If new display preferences need persistence, use typed local preferences or separately approved shared contracts; include versioned migrations for any persistent schema, rather than sending unknown server fields.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.QueueSearchAccessibilityUiTest,com.selffeed.android.ui.ArticlesTabUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 3. Make read and gesture states accessible

Replace whole-row fading with chosen colors/weight/unread indication. Verify at least 4.5:1 contrast for ordinary text and 3:1 for large text and relevant non-text controls. Add named read/unread and save actions usable without swipe, selected state, meaningful labels, and keyboard navigation. Check actual touch bounds at 48dp minimum where required; preserve text readability at 200% scale.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.QueueSearchAccessibilityUiTest,com.selffeed.android.ui.ArticlesTabUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 4. Verify dense scrolling and navigation continuity

Exercise compact/comfortable density, long titles, missing images, cached/offline states, delayed search updates and failed searches. Test selecting a result and returning to its query/scroll position, marking read in unread-only mode, and saved/offline filtering. Keep row keys stable and avoid full-list movement on background refresh. Own selected finite row-placement and read/save acknowledgement motion here, within the queue and Search components; make it interruptible and honor zero animation scale.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.QueueSearchAccessibilityUiTest,com.selffeed.android.ui.ArticlesTabUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

## Test and acceptance contract

- [ ] Main queue and Search use the approved shared density and metadata hierarchy.
- [ ] Search never presents a previous query's results/count as completed results of new input; errors and offline scope remain visible and retryable.
- [ ] Read rows remain legible; labels, states, gesture alternatives, keyboard behavior, and actual hit targets pass semantics and TalkBack checks.
- [ ] Density changes, saved/offline views, read updates, and reader return preserve the correct scope and viewport.
- [ ] No extra continuous list animation, network request per ordinary recomposition, or full article-list duplication is introduced.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not invent a new row layout or copy beyond the selected mocks.
- Do not shrink hit targets or cap system font scaling to fit more content.
- If additional preference fields require an API contract change, separate and review that contract instead of quietly broadening Android-only scope.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Keep one article-row vocabulary across queue/search/offline. A new query field must participate in request identity, displayed-result identity, and restoration.

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
