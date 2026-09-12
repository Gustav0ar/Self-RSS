# Plan 048: Recover realtime delivery gaps without losing local intent

- Status: TODO
- Priority: P2
- Effort: M
- Implementation risk: MED
- Category: bug
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [035](035-android-session-and-request-lifecycle.md), [036](036-android-cache-first-and-mutation-authority.md), [038](038-android-loading-and-error-lifecycle.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/data/repository/ReadStateStreamClient.kt' 'packages/android/app/src/main/java/com/selffeed/android/network/ReadStateEventStream.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/articles/ReadStateManager.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticleFeatureEventCoordinator.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/AppWorkflowCoordinator.kt' 'packages/android/app/src/test/java/com/selffeed/android/network/ReadStateEventStreamTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/articles/ReadStateManagerTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/ArticleFeatureEventCoordinatorTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/RealtimeRecoveryUiTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

The SSE callback flow ignores trySend failures, while downstream processing can be delayed by reconciliation. A burst can drop events and later advance the replay cursor beyond them. This resilience finding complements the reviewed refresh and mutation fixes: reconnect must converge without replaying another account or flashing loading again.

## Current state and conventions

Retain bounded buffers and backoff, session-owned replay state from plan 035, effective pending overlays from plan 036, and coalesced background reconciliation from plan 038. A cursor is safe only if events through that checkpoint have been applied or an authoritative reconciliation closes the gap. Increasing channel capacity does not guarantee delivery.

`packages/android/app/src/main/java/com/selffeed/android/data/repository/ReadStateStreamClient.kt:71`:

```kotlin
    fun events(isLoggedIn: () -> Boolean): Flow<ReadStateSyncEvent> = flow {
        var attempt = 0
        while (coroutineContext.isActive && isLoggedIn()) {
            try {
                eventsOnce().collect { event ->
                    attempt = 0
                    if (event !is RealtimeConnectedEvent && event.eventId.isNotBlank()) {
                        sseLastEventId.set(event.eventId)
                    }
                    emit(event)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                runtime.debugLog("Read-state stream disconnected: ${e.message ?: e::class.java.simpleName}")
            }

            if (!coroutineContext.isActive || !isLoggedIn()) break
            delay(readStateReconnectDelay(attempt))
            attempt++
```

`packages/android/app/src/main/java/com/selffeed/android/data/repository/ReadStateStreamClient.kt:134`:

```kotlin
                        lastEventTimestampMs = System.currentTimeMillis()
                        this@stream.trySend(RealtimeConnectedEvent())

                        val parser = SseEventParser()
                        try {
                            val source = response.body.source()
                            while (!call.isCanceled()) {
                                val line = source.readUtf8Line() ?: break
                                lastEventTimestampMs = System.currentTimeMillis()
                                parser.pushLine(line)
                                    ?.toReadStateEvent(readStateEventAdapter)
                                    ?.also { lastEventTimestampMs = System.currentTimeMillis() }
                                    ?.let { this@stream.trySend(it) }
                            }
                            parser.flush()
                                ?.toReadStateEvent(readStateEventAdapter)
                                ?.also { lastEventTimestampMs = System.currentTimeMillis() }
                                ?.let { this@stream.trySend(it) }
                            this@stream.close()
                        } catch (e: IOException) {
```

`packages/android/app/src/main/java/com/selffeed/android/ui/articles/ReadStateManager.kt:205`:

```kotlin
            is RealtimeConnectedEvent -> {
                repository.invalidateReadStateCaches()
                readStateStore.clear()
                _events.emit(ArticleFeatureEvent.ArticlesChanged())
            }
            is ArticleUpdatedEvent -> {
                repository.invalidateArticleContentCaches(event.articleId)
                _events.emit(ArticleFeatureEvent.ArticlesChanged(event.articleId))
```

`packages/android/app/src/main/java/com/selffeed/android/ui/articles/ReadStateManager.kt:217`:

```kotlin
    private suspend fun applyArticleReadStateChanged(event: ArticleReadStateChangedEvent) {
        val previous = currentArticleReadState(event.articleId)
        repository.updateCachedReadState(event.articleId, event.isRead, event.revision)
        repository.invalidateReadStateCaches(event.articleId)
        rememberArticleReadState(event.articleId, event.isRead)
        items = items.withReadState(event.articleId, event.isRead)
        selectedArticle = selectedArticle?.withReadState(event.articleId, event.isRead)

        val changed = previous?.let { it != event.isRead } ?: true
        val unreadDelta = if (!changed) 0 else if (event.isRead) -1 else 1
        _events.emit(
            ArticleFeatureEvent.ArticleReadStateChanged(
                articleId = event.articleId,
                feedId = event.feedId,
                read = event.isRead,
                unreadDelta = unreadDelta,
                readDelta = if (!changed) 0 else if (event.isRead) 1 else -1,
            ),
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/data/repository/ReadStateStreamClient.kt`
- `packages/android/app/src/main/java/com/selffeed/android/network/ReadStateEventStream.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/articles/ReadStateManager.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticleFeatureEventCoordinator.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/AppWorkflowCoordinator.kt`
- `packages/android/app/src/test/java/com/selffeed/android/network/ReadStateEventStreamTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/articles/ReadStateManagerTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/ArticleFeatureEventCoordinatorTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/RealtimeRecoveryUiTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `fix/android-realtime-recovery` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| unit red | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.ReadStateEventStreamTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticleFeatureEventCoordinatorTest'` | The newly added reproduction fails on the specific pre-fix behavior; after implementation it passes. Existing unrelated tests remain green. |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.ReadStateEventStreamTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticleFeatureEventCoordinatorTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.RealtimeRecoveryUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Reproduce a gap with a slow consumer

Use the real stream parser/callback flow with a local deterministic SSE server or transport boundary. Send more events than its bounded capacity while the consumer is suspended. Verify a failed send is observable and replay/checkpoint behavior cannot silently skip the missing read/save/content event.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.ReadStateEventStreamTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticleFeatureEventCoordinatorTest'`. The newly added reproduction fails on the specific pre-fix behavior; after implementation it passes. Existing unrelated tests remain green.

### 2. Implement bounded loss detection and reconciliation

Choose bounded backpressure or explicit gap-triggered disconnect/reconciliation, accounting for the OkHttp callback thread and cancellation. Handle every trySend result, including final parser flush and connected event. Advance the resume checkpoint only when safe under the chosen policy. Cancel heartbeat/call resources on stop and clear replay state for a new session.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.ReadStateEventStreamTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticleFeatureEventCoordinatorTest'`. All selected tests pass.

### 3. Converge without overwriting pending local state

Deduplicate/reject older revisions, preserve newer local read/save intent, and perform one authoritative catch-up when a gap or expired replay is detected. Route article changes through plan 038's background refresh policy. Avoid simultaneous reconnect collectors and tight retry loops while offline/hidden.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.network.ReadStateEventStreamTest' --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticleFeatureEventCoordinatorTest'`. All selected tests pass.

### 4. Exercise burst, reconnect, and lifecycle behavior

Run bursts, a dropped connection mid-event, malformed input, rapid foreground changes, and account switch. Assert final article state/counts/content version match the authoritative fake after delivery settles, the outbox survives, and foreground loading does not restart for every replayed event.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.RealtimeRecoveryUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

## Test and acceptance contract

- [ ] No failed channel delivery is silently ignored.
- [ ] A detected gap causes safe replay or authoritative reconciliation; later events cannot permanently skip earlier state.
- [ ] Out-of-order/duplicate remote events cannot regress current revisions or pending local intent.
- [ ] There is one foreground stream per session, bounded reconnect behavior, and no old-account replay cursor.
- [ ] Final UI/Room state converges after the burst with no repeated foreground loading animation.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not use an unbounded channel or fixed larger buffer as the only gap-recovery mechanism.
- Do not block the shared OkHttp dispatcher indefinitely to simulate reliable delivery.
- If replay server guarantees differ from assumptions, use documented authoritative reconciliation or specify the required API work separately.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Every new event type needs a reconciliation path and a revision/identity rule. Keep gap behavior tested with a consumer that really cannot keep up.

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
