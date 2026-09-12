# Plan 047: Simplify management navigation and preserve unfinished edits

- Status: TODO
- Priority: P2
- Effort: L
- Implementation risk: MED
- Category: direction
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [034](034-android-design-and-motion-selection.md), [035](035-android-session-and-request-lifecycle.md), [037](037-android-main-safe-io.md), [038](038-android-loading-and-error-lifecycle.md), [042](042-android-durable-offline-downloads.md), [043](043-android-reading-session-restoration.md), [045](045-android-dense-queue-and-search.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/FeedsTab.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/SettingsTab.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/SettingsSessions.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/FeedsViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AppNavigationModels.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AppViewModel.kt' 'packages/android/app/src/main/res/values/strings.xml' 'packages/android/app/src/test/java/com/selffeed/android/ui/FeedsViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/SettingsViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/screens/FeedDrawerRowsTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/screens/FeedHealthUxTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/FeedEditorUiTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/FeedSettingsResilienceUiTest.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/RepositoryRuntime.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/local/LocalStoreTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Subscription switching competes with sync and management controls at the top of the feed screen. Settings combines reading preferences, stats, sessions, and administration in one scroll. Editors close before acknowledgement and store drafts only in remember, losing work on failure or recreation.

## Current state and conventions

Implement the subscriptions-first and grouped settings design chosen in plan 034, preserving all existing feed/category lifecycle actions, nested categories, OPML import/export, health history, account security, and admin authorization. Errors use the reliable message/inline-state handling from plan 038. Main-safe OPML acquisition comes from plan 037. Keep forms tied to editor/session identity.

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/FeedsTab.kt:505`:

```kotlin
        is FeedManagementDialog.CategoryEditor -> CategoryEditorDialog(
            category = dialog.category,
            availableParents = allCategories.filterNot { candidate ->
                dialog.category?.let { candidate.id in it.descendantIds() } == true
            },
            onDismiss = { managementDialog = null },
            onSave = { name, parentCategoryId ->
                val category = dialog.category
                if (category == null) {
                    actions.onCreateCategory(name, parentCategoryId)
                } else {
                    actions.onUpdateCategory(category.id, name, parentCategoryId)
                }
                managementDialog = null
```

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/FeedsTab.kt:543`:

```kotlin
            onSave = { url, title, categoryId, pollingIntervalMinutes ->
                val feed = dialog.feed
                if (feed == null) {
                    actions.onCreateFeed(url, categoryId, title)
                } else {
                    actions.onUpdateFeed(feed.id, url, title, categoryId, pollingIntervalMinutes)
                }
                managementDialog = null
```

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/FeedsTab.kt:685`:

```kotlin
    var url by remember(feed?.id, initialUrl) {
        mutableStateOf(feed?.feedUrl ?: initialUrl.orEmpty())
    }
    var title by remember(feed?.id) { mutableStateOf(feed?.title.orEmpty()) }
    var categoryId by remember(feed?.id) { mutableStateOf(feed?.categoryId ?: categories.firstOrNull()?.id.orEmpty()) }
    var pollingInterval by remember(feed?.id) { mutableStateOf(feed?.pollingIntervalMinutes?.toString().orEmpty()) }
    var showCreateCategory by remember(feed?.id) { mutableStateOf(false) }
```

`packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt:79`:

```kotlin
    fun updatePreferences(request: UpdatePreferencesRequest) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(request)) {
                is AppResult.Success -> _state.update {
                    it.copy(
                        preferences = result.data.withNormalizedTheme(),
                        statusMessage = PresentationText.resource(R.string.settings_saved),
                    )
                }
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
```

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/SettingsTab.kt:185`:

```kotlin
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            stringResource(R.string.settings_hide_read),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            stringResource(R.string.settings_hide_read_detail),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(checked = prefs.hideRead, onCheckedChange = actions.onHideReadChanged)
                }
            }
        }
```

`packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt:551`:

```kotlin
    private fun refreshPreferencesInBackground() {
        val generation = sessionGeneration.get()
        refreshScope.launch {
            runCatching {
                runtime.withRetry { settingsRemote.preferences() }.also { preferences ->
                    if (generation != sessionGeneration.get() || !isLoggedIn()) return@also
                    runtime.putCached("preferences", PREFERENCES_TTL_MS, preferences)
                    localStore.writePreferences(preferences)
                }
            }
        }
    }
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/FeedsTab.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/SettingsTab.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/SettingsSessions.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/FeedsViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AppNavigationModels.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AppViewModel.kt`
- `packages/android/app/src/main/res/values/strings.xml`
- `packages/android/app/src/test/java/com/selffeed/android/ui/FeedsViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/SettingsViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/screens/FeedDrawerRowsTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/screens/FeedHealthUxTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/FeedEditorUiTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/FeedSettingsResilienceUiTest.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/RepositoryRuntime.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/local/LocalStoreTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `feat/android-feed-management-ux` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.SettingsViewModelTest' --tests 'com.selffeed.android.ui.screens.FeedDrawerRowsTest' --tests 'com.selffeed.android.ui.screens.FeedHealthUxTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.local.LocalStoreTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.FeedEditorUiTest,com.selffeed.android.ui.FeedSettingsResilienceUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Keep drafts until confirmed success

Represent each feed/category editor with an identity, saveable nonsensitive draft, submission state, and local error. Disable duplicate submit while pending; close only on confirmed success for that editor. Retain input after failures, backgrounding, and recreation. Late success for a dismissed editor must not close a newer editor. Keep password fields out of durable draft storage.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.SettingsViewModelTest' --tests 'com.selffeed.android.ui.screens.FeedDrawerRowsTest' --tests 'com.selffeed.android.ui.screens.FeedHealthUxTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.local.LocalStoreTest'`. All selected tests pass.

### 2. Make preference editing acknowledge the latest intent

Preserve pending reader-preference changes and prevent out-of-order responses from replacing newer chosen values. Coalesce/serialize rapid slider changes as appropriate and expose failure/retry using the chosen design. Do not rewrite shared server preferences or invent an offline mutation contract; define which local-only settings can persist independently and test their restoration. Enforce the same latest-intent rule at repository, memory and persistent-store boundaries: refreshPreferencesInBackground can complete an older GET after a successful PATCH. Gate/coalesce stale preference fetches and writes using the account ownership contract, not only ViewModel response order. Add a delayed GET, newer successful PATCH, late GET completion, then reload/process-restart test asserting both stored and displayed preferences remain current.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.SettingsViewModelTest' --tests 'com.selffeed.android.ui.screens.FeedDrawerRowsTest' --tests 'com.selffeed.android.ui.screens.FeedHealthUxTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.local.LocalStoreTest'`. All selected tests pass.

### 3. Implement subscriptions-first and grouped settings

Move navigation and reading preferences into the chosen hierarchy, with management and diagnostics reachable through the approved controls. Preserve feed discovery/replacement warnings, delete confirmations, polling interval edits, nested category selection, OPML summary, session revocation, and admin restrictions. Wire OPML loading/cancel/failure to the actual job rather than closing the UI before it finishes.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.FeedEditorUiTest,com.selffeed.android.ui.FeedSettingsResilienceUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 4. Verify accessibility and complete editor journeys

Use labeled toggleable rows, expanded/selected semantics, named expand/select actions, and adequate hit targets. Exercise add/edit failure then retry, rotation, nested category navigation, local OPML success/oversize/failure/cancel, failed preferences, and slow session/admin requests. Apply only finite selected expansion/save feedback. Check phone narrow width and 200% text.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.FeedEditorUiTest,com.selffeed.android.ui.FeedSettingsResilienceUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

## Test and acceptance contract

- [ ] Failed or interrupted editor submissions preserve nonsensitive input and remain retryable.
- [ ] Only the correct successful editor submission dismisses its dialog; duplicate submissions are prevented.
- [ ] Rapid preference updates retain the latest user choice and expose unsaved failures clearly.
- [ ] Subscription switching precedes management chrome and settings follow the selected grouping without losing existing capabilities.
- [ ] Labeled switches, category expansion, keyboard/TalkBack actions, and scaled layouts pass the required checks.
- [ ] OPML progress reflects actual acquisition/import completion and cancellation closes its resources.
- [ ] A stale background preference GET cannot overwrite a later successful PATCH in memory or persistent storage, including after process restart.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not remove existing account/admin functionality merely to simplify the settings layout.
- Do not store passwords or session tokens in saved drafts or screenshots.
- If a feed operation's server semantics are ambiguous, retain the draft and error rather than pretending success.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Every editor completion must carry its editor/request identity. New settings belong in an existing selected group with a clear persistence and acknowledgment policy.

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
