# Plan 037: Keep networking, document reads, and body preparation off Main

- Status: IMPLEMENTED; physical frame comparison pending
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

- [x] The cookie-only restore reaches the real refresh implementation without synchronous networking on Main.
- [x] ContentResolver reads and full cached-body decoding occur off Main; all streams close after failure/cancellation.
- [x] Preparing long reader documents does not run inside composition and obsolete prepared results cannot replace the current article/version.
- [x] No StrictMode disk/network Main violation occurs for the scoped fixture journeys.
- [x] Existing auth retry, OPML size limit, HTML sanitation, text extraction, and swipe tests pass.
- [x] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [x] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [x] `git diff --check` passes and scope review finds no unrelated changes.
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

### Reconciliation and storage/error slice

Base `d2e3d48`, after #67. Main already moves cookie-only refresh to IO and uses cancellable bounded OPML stream acquisition. Existing parser functions still run in composition, cached detail/categories/preferences decoding resumes on the caller, and HTTP error-body acquisition/parsing runs in the HttpException catch on that caller. A secondary body-read exception escapes that catch.

First review slice makes the public stored-body/snapshot and HTTP-error boundaries main-safe, retaining existing Room transactions and state ordering. Error text is bounded before decoding; unreadable/oversized bodies use the status fallback, with cancellation preserved. Scope adds shared `LocalStoreMainSafeContract.kt` and JVM/device wrappers plus `data/repository/RepositoryRuntimeTest.kt` to prove those concrete boundaries. It does not add a transaction to move parsing off Main. Existing state reconciliation still serializes some body updates; normalization and bounded maintenance remain plan 041. Reader preparation, feature-owned import acquisition and actual reader responsiveness remain subsequent work within 037.

The five storage/error reproductions fail in `/tmp/android-main-safe-storage-red.log`. The complete JVM suite then passes 588 cases, lint and both isolated APK pairs in `/tmp/android-main-safe-storage-build.log`, including a blocked-read cancellation/close case. JSON and blocking-read dispatchers are constructor dependencies with production defaults, following [Android coroutine guidance](https://developer.android.com/kotlin/coroutines/coroutines-best-practices). A subsequent focused/device gate will verify those final constructor changes. The 64 KiB error-text cap bounds this error-handler read and parse; Retrofit may already have buffered the transport response, so this is not a network download budget.

Further source review finds OPML export writing and stale-export cleanup on Main in `ui/components/ExternalActions.kt` and Application startup. Expand the remaining OPML slice to that existing helper, `SelfFeedApplication.kt`, export collection in `SelfFeedAppRoute.kt`, and focused stream/file lifecycle tests. Keep this work separate from the current storage/error PR.

Final storage/error checks pass the six affected JVM cases, lint and isolated builds in `/tmp/android-main-safe-storage-final-build.log`. Both shared Room cases pass on Android Main in `/tmp/android-main-safe-storage-device.log` on API 35. The prior complete suite passes 588 JVM tests. These are dispatcher/cancellation checks; reader responsiveness, StrictMode journeys and physical timing remain open. No schema or added transaction.

### Reader preparation slice

Base `d0ae621` (#68). Move HTML document construction and text extraction behind a dispatcher-injected `ReaderContentPreparer`, with composition-owned requests keyed by article identity and actual rendering inputs. Keep a valid document while preparing enrichment within the same article, but never pair old HTML with a replacement base URL or article. Cancellation must prevent obsolete publication; preparation captures immutable inputs, never an Activity/View. Add `ReaderContentPreparer.kt`, focused unit tests and `AndroidMainThreadUiTest.kt`. Remove the unused `ArticleReaderDialog.kt`, whose only repository reference is its declaration. Extend scope to the supported `ReaderWebView.kt` document identity so comparing prepared HTML does not allocate a second full concatenated document on Main. Layout/copy stay unchanged; the existing skeleton covers initial preparation. OPML and StrictMode journeys remain separate work.

Asynchronous text preparation reproduces a restoration regression: both the existing authentication-delayed reader test and a new gated preparation case restore 600 px as zero in `/tmp/android-reader-preparation-scroll-red.log`. The necessary dependency is a small `ReaderScrollPosition.kt` that saves pending offset intent until actual body layout, including a second recreation while preparation is still queued. Text readiness comes from placement, not from request completion. The same slice adds the shared `ReaderPreparationGate.kt` and extends `ReaderSessionRestorationTest.kt`; no arbitrary delay or new visual treatment is used.


The preparation change also requires readiness and mode-switch checks in the existing `ArticleMediaLifecycleUiTest.kt`. A gated long-document test reproduces a 1,500 px reading position clamping to 32 px while enrichment is queued in `/tmp/android-reader-enrichment-red.log`. Retain the displayed renderer height by article identity until its valid height callback. The JVM callback-order test reproduces visual readiness arriving before the measured body in `/tmp/android-reader-rich-placement-red.log`. First rich restoration now waits for a positive document height, visual readiness, removal of the skeleton and body placement. Text readiness follows actual placement. Completion waits for a ready body before starting its existing five-second dwell.

The two-page video fixture repeatedly throws `LayoutNode should be attached to an owner` after switching Rich to Text. Holding text preparation reproduces the same failure before text publication in `/tmp/android-reader-mode-held-red.log`; phase evidence is retained in `/tmp/android-reader-mode-held-results`. Keeping the text layout container present while its blocks are prepared removes that exception. The first corrected run reaches the final text assertion, which exposed a fixture mistake: both pager pages correctly have text, so the assertion must target the primary page. The final test set covers the original ungated transition and the gated transition. Temporary phase logging is removed. This establishes the failing application transition, not an upstream Compose root-cause claim.

Readiness effects wait once per prepared document using `snapshotFlow`, preventing callback duplication when placement occurs before an effect starts. The close-during-preparation test drains tracked preparation dispatch before asserting no renderer or readiness publication. Cancellation prevents obsolete publication; an individual synchronous HTML/regex operation is not interrupted in the middle. No native memory or physical performance claim follows from these tests.


Final reader checks pass all 593 JVM cases, lint and both isolated APK pairs in `/tmp/android-reader-preparation-ci-jdk-build.log`, and all 125 API 35 device cases in `/tmp/android-reader-preparation-ci-jdk-device.log`. This includes real WebView audio/video navigation, both mode-switch cases, repeated fullscreen/background cycles, renderer recovery, all supported Room migrations, foreground ownership and fast swipes. The final fixture cleanup replaces a blocking test coroutine with direct scroll-state setup; its five affected device cases pass in `/tmp/android-reader-preparation-final-fixture.log`. Source review's last correction tests actual placement, rather than preparation, before treating a subsequent rich callback as an already laid-out body.

The first complete JVM attempt aborted in the host JBR 21 C2 compiler while compiling Robolectric `SQLiteDirectCursorDriver.query`, at `libjvm.so:Node::uncast`. The report and replay are retained at `/tmp/android-reader-preparation-host-jvm-crash.log` and `/tmp/android-reader-preparation-host-jvm-replay.log`. The complete passing run launches Gradle with installed Temurin 17.0.20+8. However, `gradle/gradle-daemon-jvm.properties` pins the daemon to JetBrains Java 21, overriding `JAVA_HOME` for the daemon and its default test runtime. The passing run therefore does not establish that changing the test runtime fixed the compiler crash. Its cause remains unexplained; no runtime-selection workaround was committed. No application or test check was disabled. The emulator remains API 35, Android 15, WebView 124.0.6367.219, 320×640 at density 160. Physical frame/heap/battery evidence remains pending.


### OPML import ownership slice

Base `e186e52` (#69, documentation correction only after `2311ff1`). The picker currently acquires provider data in a composition coroutine that captures Activity Context; the ViewModel starts a separate untracked upload afterward. Move the URI action into `FeedsViewModel` with an application-context reader, one replaceable import job, and a feature-owned read-error field using the existing dialog/copy. Preserve current repository/API contracts and the 5 MiB limit. Scope adds an actual Android pipe cancellation case in `androidTest/.../ui/OpmlReaderUiTest.kt`, alongside the existing Feeds ViewModel, screen contracts, route and OPML reader tests. This checks whether thread interruption really closes a blocked Android file descriptor. Export sharing/startup cleanup and bootstrap/StrictMode acceptance remain separate slices.


The older-import summary race fails in `/tmp/android-opml-import-order-red.log`. More importantly, the real API 35 pipe test fails before the stream change in `/tmp/android-opml-pipe-cancel-red.log`: interruption does not complete cancellation until the provider supplies data. The fixed structured read closes the atomically owned input from another IO thread when its await is cancelled. It also sends a `CancellationSignal` to a pending `openAssetFileDescriptor`, which supports document slices. The final pipe check passes and verifies exactly one close in `/tmp/android-opml-pipe-final.log`. [ContentResolver documentation](https://developer.android.com/reference/android/content/ContentResolver) describes the cancellable asset-descriptor API. The short import uses the picker grant; it does not retain URI permissions for future process restarts.

The reader holds application context only. The ViewModel owns acquisition and upload in one replaceable job; cancellation checks reject late results from both stages. Its read error uses existing `PresentationText` and the existing dialog, with a scoped dismiss action. The 43 focused JVM cases pass in `/tmp/android-opml-import-focused-2.log`, including a provider open that ignores interruption but responds to its cancellation signal, close after descriptor-to-stream failure, late noncancellable results, feature cancellation and retry. Independent review identified a test that was too cooperative to exercise the late-result guard; its deferred result now returns under `NonCancellable`. No remaining source finding was reported.

All 599 JVM tests, lint and both isolated APK pairs pass in `/tmp/android-opml-import-final-build.log`. The first selected device command included an incorrect class name and failed selection; the corrected command uses `AndroidSessionLifecycleUiTest` and all 25 selected device cases pass in `/tmp/android-opml-import-final-device-2.log`. No test or device-execution guard was weakened. OPML export/startup IO, cookie-only bootstrap and StrictMode reader acceptance still remain.


### OPML export ownership slice

Base `0659de7` (#70). Extend the existing export scope to `data/OpmlExportStore.kt`, `ui/OpmlExportEffect.kt` and their focused JVM/device tests. File preparation and maintenance belong to an application-context store; one pending prepared export belongs to the account Feeds ViewModel. The resumed screen renews retention on IO, rechecks session/identity, then launches and acknowledges the chooser without another suspension. A cleared feature discards unshared files. There is no Activity reference or standalone timer scope in the store.

The missed export event reproduces in `/tmp/android-opml-export-event-red.log`. Review found a second race: a long-pending file could be reaped after sharing if the process died before queued retention renewal. `/tmp/android-opml-export-retention-red.log` reproduces this with a held maintenance dispatcher and fresh store. Retention now updates before the chooser handoff. The focused file tests cover unique atomic names, full UTF-8 contents, cancelled resource returns, provider failure, pending-file protection, and cleanup restricted to owned OPML names. Robolectric assigns different application cache roots per test; the fixture reattaches FileProvider using its public API to invalidate the previous test's authority cache.

Shared files remain in the private FileProvider directory for 24 hours after handoff, then become eligible for startup/next-export maintenance. The OS may evict cache files. Pending exports are pinned in the current process; abandoned files after process death expire by age. This removes the arbitrary five-minute deletion timer. Byte quotas and broader cache policy remain plan 041. Failed preparation or chooser launch uses one localized fallback error in the existing message presentation; layout is unchanged.

All 48 focused JVM checks and isolated app APKs pass in `/tmp/android-opml-export-focused-3.log`. All three API 35 device cases pass in `/tmp/android-opml-export-device.log`, including actual Activity recreation, account retirement, FileProvider contents/permission intent and scoped StrictMode disk/network checks on Main. The chooser intent is intercepted; receipt by another installed app is not claimed. Final full-suite/build and integrated startup acceptance are in progress. The added gated retention case covers stopping and account clearing during the IO handoff. Cookie-only bootstrap and reader StrictMode acceptance remain separate work.


Final export validation: all 610 JVM tests and both isolated APK pairs pass in `/tmp/android-opml-export-final-apks.log`. Both isolated variants' lint checks pass in `/tmp/android-opml-export-final-lint.log`. The first combined lint/build invocation failed while lint read generated benchmark files during KSP regeneration; `/tmp/android-opml-export-final-build.log` retains that failure. Running generation/builds before lint, in separate invocations, passes without changing build settings or disabling checks. The exact build-tool race remains a verification-infrastructure follow-up.

All 28 affected API 35 device cases pass in `/tmp/android-opml-export-final-device.log`. Both actual process recovery cases pass in `/tmp/android-opml-export-process.log`, exercising the production Application and its new injected store in the minified isolated package. The gated unit case verifies pending-file preservation after a stopped handoff and invalidation when the account is cleared during retention renewal. Independent review findings are addressed. No Room schema changed; physical heap/frame/battery acceptance remains plan 049.


### Cookie-only bootstrap cancellation

Base `bbd6d73` (#71). The real HTTP/SessionStore/NetworkModule/AuthViewModel fixture in `data/CookieOnlyBootstrapTest.kt` confirms that cookie-only restoration already runs the blocking refresh off Main. It reproduces delayed cancellation in `/tmp/android-cookie-bootstrap-red.log`: cancelling the ViewModel does not finish while the server withholds headers. The old `withContext(IO)` call does not cancel OkHttp, and the coordinator uses an uncancellable monitor for serialization.

Extend this slice to the new fixture, the existing network/repository tests and coordinator within `NetworkModule.kt`. Replace the monitor with one coroutine Mutex shared by the suspend refresh and synchronous Authenticator adapter. Cancellation must stop the owned Call, including blocked response-body reads, and reject late credential publication. Keep certificate pinning, cookie ownership, existing timeouts and the single coordinator. Inject only the refresh transport factory for actual HTTP/thread/closure assertions. Reader StrictMode acceptance remains separate.


The blocked-body and cancelled-waiter checks also pass in `/tmp/android-cookie-bootstrap-body-lock.log`. Add `androidTest/.../network/SessionRefreshLifecycleDeviceTest.kt` for actual Android Main, AndroidKeyStore-backed SessionStore and socket cancellation. Its small server binds only loopback. Add a `deviceTest`-only network security resource allowing `127.0.0.1`, matching the existing performance-test fixture restriction; production/debug security resources remain unchanged. The synchronous Authenticator adapter still has a bounded refresh lifetime independent of cancellation of its original API call, and existing owner-checked cookie persistence may finish once started. Do not describe this slice as cancellation of every authentication callback.


Final refresh validation: all 614 JVM tests and both isolated APK pairs pass in `/tmp/android-session-refresh-final-build.log`. Both isolated lint variants pass in `/tmp/android-session-refresh-final-lint.log`. All 30 selected API 35 device cases pass in `/tmp/android-session-refresh-final-device.log`, including the two actual socket cases, account/Activity recreation, authentication, and OPML import/export. `/tmp/android-cookie-bootstrap-device.log` also passes the two standalone socket cases. Their StrictMode checks report no Main disk/network violations; cancellation finishes while the fixture server still withholds headers/body. The JVM AuthViewModel fixture reaches the real coordinator and HTTP transport; only AndroidKeyStore lookup is substituted there, while the Android test uses the real encrypted SessionStore.

Independent source review found no new blocker. Its two additional recommendations, stalled body and cancelled mutex waiter, pass. The waiter test also proves the synchronous adapter and suspend path share the same coordinator and permit a later refresh. No persistent schema, application network policy or configured production timeout changes. Test cleartext permission is restricted to loopback in the isolated device-test variant. Reader StrictMode journeys and physical frame comparison remain pending, so plan 037 is still IN PROGRESS.


### Cached reader StrictMode acceptance

Base `2d5a6c0` (#72). Add a scoped actual Room-to-`ReaderHtmlContent` journey to `AndroidMainThreadUiTest.kt`. Prepopulate only a uniquely named test database, then enforce Main-thread disk/network StrictMode during cache acquisition, rich-reader preparation/placement, rapid document replacement and closing while preparation is held. Use the production renderer/preparer and existing preparation gate, with no network bypass or alternate document renderer. This is a component-level correctness check alongside the existing full-app Hilt and reader tests; it is not a physical frame benchmark or heap measurement.


The scoped reader journey passes in `/tmp/android-reader-strictmode-device.log`; all six preparation/Main-thread cases pass again after teardown hardening in `/tmp/android-reader-strictmode-final-device.log`. The test restores Main's previous StrictMode policy and closes only its named database even if UI cleanup fails. Cached first/third documents render, the superseded second document cannot publish, and closing during held preparation leaves no active renderer or late readiness callback. No Main disk/network violations were recorded.

Debug and device-test lint pass in `/tmp/android-reader-strictmode-lint.log`; final device-test lint also passes after the teardown-only change in `/tmp/android-reader-strictmode-final-lint.log`. This slice changes only instrumentation and documentation. The inherited production implementation passed all 614 JVM tests, both isolated APK pairs and both isolated lint variants at `2d5a6c0`, with 30 affected device cases. Physical frame comparison is still pending in plans 033/049; it is not inferred from dispatchers or StrictMode. Plan 037's implementation and scoped correctness checks are complete, allowing dependent work to continue without marking the physical gate done.
