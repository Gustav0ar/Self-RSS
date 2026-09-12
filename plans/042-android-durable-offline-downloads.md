# Plan 042: Resume offline downloads and serve cached media to the reader

- Status: TODO
- Priority: P1
- Effort: L
- Implementation risk: MED
- Category: migration
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [034](034-android-design-and-motion-selection.md), [035](035-android-session-and-request-lifecycle.md), [036](036-android-cache-first-and-mutation-authority.md), [037](037-android-main-safe-io.md), [039](039-android-media-and-reader-resource-lifecycle.md), [040](040-android-reader-readiness-and-fallback.md), [041](041-android-cache-retention-and-budgets.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabase.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabaseMigrations.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/OfflineReadStore.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/OfflineDownloadWorker.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/OfflineResourceStore.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/OfflineDownloadRepository.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/SelfFeedRepositories.kt' 'packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt' 'packages/android/app/src/main/java/com/selffeed/android/SelfFeedApplication.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/SettingsTab.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/OfflineStatus.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/utils/MediaTrust.kt' 'packages/android/app/src/main/res/values/strings.xml' 'packages/android/app/schemas/' 'packages/android/app/src/test/java/com/selffeed/android/data/' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/OfflineStatusTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/utils/MediaTrustTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/OfflineArticleLifecycleUiTest.kt' 'packages/android/app/src/androidTest/assets/android-review/' 'packages/android/app/src/main/java/com/selffeed/android/data/ArticlePageQuery.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/ArticleRemoteMediator.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/SearchTab.kt' 'scripts/android-review-process.sh' 'packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/OfflineDownloadProcessTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Saved state is durable, but body acquisition is a detached best-effort job and rich-reader images use a different cache from Coil prefetch. Make offline preparation resumable and observable, then render the actual retained resources without relying on WebView's independent HTTP cache.

## Current state and conventions

The existing OfflineTextStatus correctly distinguishes persisted readable text from bookmark state. Extend that distinction rather than treating saved=true as downloaded=true. Read/save outbox delivery remains plan 036's responsibility. Offline body/image preparation needs its own durable state, ownership, cancellation, retry, and storage policy. Use plan 041's metadata/budgets and plan 034's chosen download/removal UI. No new backend contract is assumed. Persist work against plan 035's durable owner identity, not its in-memory request counter; token refresh and ordinary process recreation must not orphan downloads.

`packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt:671`:

```kotlin
    override suspend fun setSaved(articleId: String, saved: Boolean) = safeCall {
        val key = "article:$articleId"
        val previous = runtime.getCached<ArticleDetail>(key)
        localStore.queueSavedStateMutation(articleId, saved)
        if (previous != null) {
            runtime.putCached(key, ARTICLE_DETAIL_TTL_MS, previous.copy(isSaved = saved))
        }
        runtime.invalidateByPrefix("articles")
        runtime.invalidateByPrefix("search")
        runCatching { ArticleStateSyncWorker.kickOnce(imageRequestContext) }
        if (networkMonitor.online.value) flushPendingArticleStateMutations()
        if (saved) {
            if (previous == null) backgroundRefreshArticle(articleId, cacheImages = true)
            else cacheArticleImages(previous.copy(isSaved = true))
        }
        saved
    }
```

`packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt:507`:

```kotlin
    private fun backgroundRefreshArticle(articleId: String, cacheImages: Boolean = false) {
        val generation = sessionGeneration.get()
        refreshScope.launch {
            try {
                val detail = localStore.applyPendingArticleState(
                    runtime.withRetry { articleRemote.article(articleId) },
                )
                if (generation != sessionGeneration.get() || !isLoggedIn()) return@launch
                runtime.putCached("article:$articleId", ARTICLE_DETAIL_TTL_MS, detail)
                offlineReadStore.writeArticleDetail(detail)
                if (cacheImages) cacheArticleImages(detail)
            } catch (_: Exception) {
                // Background refresh is best-effort. The cached copy the
                // user is already reading is still valid.
            }
        }
```

`packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt:103`:

```kotlin
    fun createImageLoader(context: PlatformContext): ImageLoader {
        // Saved articles promise offline media across ordinary OS cache
        // eviction, so keep Coil's bounded cache in app-owned persistent data.
        val diskCacheDir = File(context.filesDir, "image_cache").toOkioPath()
        return ImageLoader.Builder(context)
            .diskCache {
                DiskCache.Builder()
                    .directory(diskCacheDir)
                    .maxSizeBytes(50L * 1024 * 1024)
                    .build()
            }
            .build()
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt:561`:

```kotlin
        update = { webView ->
            val contentKey = "$documentBaseUrl\n$processedHtml"
            if (webView.tag != contentKey) {
                webView.tag = contentKey
                webView.loadDataWithBaseURL(
                    documentBaseUrl,
                    processedHtml,
                    "text/html",
                    "utf-8",
                    documentBaseUrl,
                )
            }
        },
        onRelease = { webView ->
            webView.releaseReaderResources()
```

`packages/android/app/src/main/java/com/selffeed/android/data/ArticleStateSyncWorker.kt:24`:

```kotlin
    override suspend fun doWork(): Result {
        repository.prepareSession()
        if (!repository.isLoggedIn()) return Result.success()
        return if (repository.flushPendingArticleStateMutations()) Result.success() else Result.retry()
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabase.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabaseMigrations.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/OfflineReadStore.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/OfflineDownloadWorker.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/OfflineResourceStore.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/OfflineDownloadRepository.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/SelfFeedRepositories.kt`
- `packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt`
- `packages/android/app/src/main/java/com/selffeed/android/SelfFeedApplication.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SettingsViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedAppRoute.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/ArticlesTab.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/SettingsTab.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/OfflineStatus.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/utils/MediaTrust.kt`
- `packages/android/app/src/main/res/values/strings.xml`
- `packages/android/app/schemas/`
- `packages/android/app/src/test/java/com/selffeed/android/data/`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/OfflineStatusTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/utils/MediaTrustTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/OfflineArticleLifecycleUiTest.kt`
- `packages/android/app/src/androidTest/assets/android-review/`
- `packages/android/app/src/main/java/com/selffeed/android/data/ArticlePageQuery.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/ArticleRemoteMediator.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SearchViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/SearchTab.kt`
- `scripts/android-review-process.sh`
- `packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/OfflineDownloadProcessTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `feat/android-offline-downloads` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| migration | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest'` | Clean creation and every supported migration path pass with preserved fixture data. |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.OfflineDownloadWorkerTest' --tests 'com.selffeed.android.data.OfflineResourceStoreTest' --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.components.OfflineStatusTest' --tests 'com.selffeed.android.ui.utils.MediaTrustTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.OfflineArticleLifecycleUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| process | `bash scripts/android-review-process.sh 'com.selffeed.android.macrobenchmark.OfflineDownloadProcessTest'` | The separately hosted test runner survives target death; all selected recovery journeys pass with verified old/new target PIDs and persisted state. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Persist offline intent and state

Add typed states for queued, downloading, available text, available requested media, and failed/retryable work, keyed by session ownership plus article/version. Define what default Save downloads using the chosen mock: at minimum readable body; requested images are tracked separately. Migrate forward from plan 041's resulting version, backfill verified existing bodies, and queue missing preparation only within the current account. Never mark a bookmark available solely from its saved bit.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest'`. Clean creation and every supported migration path pass with preserved fixture data.

### 2. Implement resumable acquisition

Use constrained unique WorkManager jobs for preparation with bounded concurrency, retry/backoff, and current-session checks before writes. Persist intent before enqueueing and reconcile unfinished work after process restart so a crash between those steps does not strand it. Store resource files atomically and mark availability only after durable success. Cancellation, unsave/removal, offline transitions, and low storage preserve already available content and pending read/save changes.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.OfflineDownloadWorkerTest' --tests 'com.selffeed.android.data.OfflineResourceStoreTest' --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.components.OfflineStatusTest' --tests 'com.selffeed.android.ui.utils.MediaTrustTest'`. All selected tests pass.

### 3. Share the media resolver with WebView

Build one app-owned resource resolution path used by save/prefetch and WebView resource requests. Resolve relative URLs against the document base, preserve MIME/encoding, validate allowed schemes/origins, and keep auth cookies/headers scoped to the API rather than forwarding them to publishers. Retain current sanitation and media trust rules. Reuse verified existing Coil bytes where practical; a warm cache hit must be consumable by the rich reader. Do not attempt to download DRM streams, provider iframe applications, or arbitrary linked pages.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.OfflineDownloadWorkerTest' --tests 'com.selffeed.android.data.OfflineResourceStoreTest' --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.components.OfflineStatusTest' --tests 'com.selffeed.android.ui.utils.MediaTrustTest'`. All selected tests pass.

### 4. Expose real offline availability and controls

Implement the chosen available-offline filter/view, progress/failure/retry, text-versus-media status, and storage usage/removal controls. A removed download and an unsaved bookmark are separate intents when the design provides separate actions. A cached offline open must not require successful authentication transport if the existing offline lease permits access. Local search should query cached content directly when offline and disclose its scope. Keep normal read controls working without network. Extend ArticlePageQuery and the local paging path so an availability filter selects only verified local resources; do not treat it as an unsupported server parameter. Wire Search state and screen controls to the same local availability contract.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.OfflineArticleLifecycleUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 5. Verify restart, removal, and media integrity

Save without opening, stop the test process mid-download, restart offline, and verify completed text/images render with network requests rejected. Resume unfinished work after connectivity returns. Exercise image URL changes/content-version updates, duplicate resources, corrupted/missing files, failed writes, account switch, and removal while a renderer holds a resource. Protect shared files still referenced by another retained article. Run restart cases from plan 033's separate-process UiAutomator harness. Keep the test runner alive while killing/restarting only the isolated target and verify old/new target PIDs; in-app ActivityScenario tests cover ordinary UI cases, not target-process death. Once OfflineResourceStore defines ownership and references, reconcile orphan app-owned resource files and metadata in bounded interruptible batches. Keep Coil-managed files under Coil's cache API and preserve every file still referenced by retained content.

Verify with `bash scripts/android-review-process.sh 'com.selffeed.android.macrobenchmark.OfflineDownloadProcessTest'`. The separately hosted test runner survives target death; all selected recovery journeys pass with verified old/new target PIDs and persisted state.

## Test and acceptance contract

- [ ] Body/media preparation survives process death and resumes without requiring the user to reopen the article.
- [ ] Text/media status is derived from verified persisted resources and remains truthful after eviction, corruption, and partial failure.
- [ ] The rich reader displays images from the app-owned cache with network unavailable; no duplicate download is needed for an existing compatible cache hit.
- [ ] Offline viewing/filtering/search and retry/removal match the selected design.
- [ ] Default downloads respect metered-network/storage policy and never autoplay or automatically download embedded streaming video.
- [ ] All migration paths preserve prior retained content and queued changes; old-account jobs cannot write into the new account.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not treat WebView CACHE_ELSE_NETWORK or a saved flag as proof of durable offline availability.
- If an API endpoint is required, specify and review that separate contract before expanding into API/web source.
- If publisher authentication, DRM, or an unsupported embedded provider is required for a resource, mark that resource online-only and preserve text; do not weaken security or claim full offline support.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Keep download intent, bookmark state, and cache residency separate. Every resource reader and writer must use the same ownership and retention rules. Revisit provider behavior without broadening downloaded resource types silently.

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
