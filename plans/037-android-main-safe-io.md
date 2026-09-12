# Plan 037: Keep networking, document reads, and body preparation off Main

- Status: TODO
- Priority: P1
- Effort: M
- Implementation risk: MED
- Category: perf
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [035](035-android-session-and-request-lifecycle.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/network/NetworkModule.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/RepositoryRuntime.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/FeedsTab.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/FeedsViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt' 'packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt' 'packages/android/app/src/test/java/com/selffeed/android/network/NetworkModuleTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/local/LocalStoreTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/FeedsViewModelTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderTextContentTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidMainThreadUiTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Cookie-only restoration invokes synchronous OkHttp from viewModelScope, OPML acquisition reads a ContentResolver stream in the picker callback, and cached JSON is decoded after a suspend DAO call on the caller context. These paths can fail or delay input exactly when the app is opening or navigating.

## Current state and conventions

Kotlin suspend does not automatically move work off Main. Retrofit suspend endpoints are already asynchronous; move the blocking acquisition/decoding boundaries, not every ViewModel wholesale. Use MainDispatcherRule and controllable dispatchers for behavior tests. Preserve the bounded 5 MiB OPML limit, generated Moshi adapters, and authenticator single-refresh coordination.

`packages/android/app/src/main/java/com/selffeed/android/network/NetworkModule.kt:68`:

```kotlin
    fun refreshAccessToken(): SessionRefreshResult = synchronized(lock) {
        val refreshCookie = runCatching { sessionStore.getRefreshCookie() }
            .getOrElse { error -> return@synchronized SessionRefreshResult.Unavailable(error) }
        if (refreshCookie.isNullOrBlank()) {
            return@synchronized SessionRefreshResult.Unavailable(
                IOException("No refresh cookie is stored"),
            )
        }

        val request = Request.Builder()
            .url(apiEndpointUrl(sessionStore.getApiBaseUrl(), "auth/refresh"))
            .post("{}".toRequestBody("application/json".toMediaType()))
            .header("X-Self-Feed-Client-Id", sessionStore.getClientId())
            .header("X-Self-Feed-Device-Name", androidDeviceName())
            .header("User-Agent", androidUserAgent())
            .build()

        runCatching {
            refreshClient.newCall(request).execute().use { response ->
```

`packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt:505`:

```kotlin
    override suspend fun readArticleDetail(articleId: String): ArticleDetail? =
        readableArticleDetail(dao.readArticleDetail(articleId))

    private suspend fun readableArticleDetail(detail: ArticleDetailEntity?): ArticleDetail? {
        detail ?: return null
        val parsed = runCatching { articleDetailAdapter.fromJson(detail.payloadJson) }.getOrNull()
        if (System.currentTimeMillis() - detail.writtenAt > MAX_ARTICLE_DETAIL_AGE_MS) {
            // A saved article is an explicit offline promise. It remains readable
            // until the user unsaves it or signs out, even after normal cache TTLs.
            if (parsed?.isSaved == true) return parsed
            dao.clearArticleDetail(detail.id)
            return null
        }
        return parsed
```

`packages/android/app/src/main/java/com/selffeed/android/ui/screens/FeedsTab.kt:242`:

```kotlin
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val contents = readBoundedOpml(context, uri)
        if (contents == null) {
            importError = opmlReadError
        } else {
            actions.onImportOpml(uri.lastPathSegment?.substringAfterLast('/') ?: "feeds.opml", contents)
        }
```

`packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt:57`:

```kotlin
internal fun ReaderTextContent(
    html: String?,
    text: String?,
    fallback: String?,
    appearance: ReaderAppearance = ReaderAppearance(),
    modifier: Modifier = Modifier,
) {
    val blocks = remember(html, text, fallback) { readerTextBlocks(html, text, fallback) }
    val paragraphStyle = MaterialTheme.typography.bodyLarge.copy(
        fontFamily = appearance.font.composeFontFamily,
        fontSize = appearance.boundedTextSizeSp.sp,
        lineHeight = (appearance.boundedTextSizeSp * 1.72f).sp,
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/network/NetworkModule.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/RepositoryRuntime.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/FeedsTab.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/FeedsViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderTextContent.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ReaderHtmlDocument.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt`
- `packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt`
- `packages/android/app/src/test/java/com/selffeed/android/network/NetworkModuleTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/local/LocalStoreTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/FeedsViewModelTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/components/ReaderTextContentTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidMainThreadUiTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `perf/android-main-safe-io` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| unit red | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.components.ReaderTextContentTest'` | The newly added reproduction fails on the specific pre-fix behavior; after implementation it passes. Existing unrelated tests remain green. |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.components.ReaderTextContentTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidMainThreadUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Add dispatcher-sensitive reproductions

Exercise cookie-only bootstrap through AuthViewModel/repository with a controlled HTTP server or injected blocking transport; do not replace the whole refresh coordinator with a mock. Assert the blocking operation is never Main. Add slow/failing OPML provider and long cached body cases, proving unrelated input remains responsive.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.components.ReaderTextContentTest'`. The newly added reproduction fails on the specific pre-fix behavior; after implementation it passes. Existing unrelated tests remain green.

### 2. Make blocking boundaries main-safe

Provide a suspend main-safe refresh path for restoreSession while retaining a correctly scheduled synchronous adapter for OkHttp's Authenticator if needed. Keep one refresh coordination mechanism and session fence. Decode cached JSON and prepare HTML/text blocks off Main with cancellation. Publish only current article/version/style results; avoid reparsing for unrelated recompositions.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.components.ReaderTextContentTest'`. All selected tests pass.

### 3. Move OPML acquisition into cancellable work

Have the picker dispatch URI handling into feature-owned work, acquire and close the stream on IO, and enforce the byte limit incrementally. Preserve permissions for the actual lifetime needed. Do not retain Activity Context in a long-lived job. Keep existing visible behavior unless the selected design from plan 034 is available; progress/copy changes belong to plan 047.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.NetworkModuleTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.FeedsViewModelTest' --tests 'com.selffeed.android.ui.components.ReaderTextContentTest'`. All selected tests pass.

### 4. Verify responsiveness in actual readers

Run the local large-body and slow-document fixtures with StrictMode enabled only in the test target. Capture frame timing for cache-open and rapid swipes, check cancellation after Back/session change, and compare to plan 033's baseline. Record measurements without claiming improvement from dispatcher tests alone.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidMainThreadUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

## Test and acceptance contract

- [ ] The cookie-only restore reaches the real refresh implementation without synchronous networking on Main.
- [ ] ContentResolver reads and full cached-body decoding occur off Main; all streams close after failure/cancellation.
- [ ] Preparing long reader documents does not run inside composition and obsolete prepared results cannot replace the current article/version.
- [ ] No StrictMode disk/network Main violation occurs for the scoped fixture journeys.
- [ ] Existing auth retry, OPML size limit, HTML sanitation, text extraction, and swipe tests pass.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not use runBlocking on Main or introduce a second independent token-refresh lock.
- If moving work changes cancellation behavior, fix cancellation at the boundary rather than catching it as an ordinary error.
- Do not use CPU-heavy parsing on a shared serialized Room write transaction merely to get it off Main.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Main-safety belongs in reusable IO/preparation functions so future callers remain safe. Keys for prepared content must include actual content version and any rendering inputs.

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
