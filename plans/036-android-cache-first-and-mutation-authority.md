# Plan 036: Return cached content immediately and preserve the latest mutation

- Status: IN PROGRESS
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
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabase.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/ArticleStateSyncWorker.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/SelfFeedRepositories.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/articles/ReadStateManager.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/ArticleReadStateStore.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/ArticleStateSyncWorkerTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/local/LocalStoreTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/articles/ReadStateManagerTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/ArticlesViewModelTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Cached reads currently wait for the pending read/save queue to drain, potentially through many retries. Several callers can drain concurrently, and old acknowledgements update memory even when Room rejects them. Preserve one local authority and decouple reading from delivery.

## Current state and conventions

Room stores mutation IDs, revisions, prior state, and pending overlays. LocalStore already conditionally acknowledges by mutation ID. RssRepository and ReadStateManager must use the effective local result, not raw remote values. AppResult is the repository error convention; CancellationException must propagate. Retain the current server mutation protocol and endpoint shapes.

`packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt:464`:

```kotlin
    override suspend fun article(articleId: String, forceRefresh: Boolean) = safeReadCall {
        flushPendingArticleStateMutations()
        if (forceRefresh) {
            val stale = runtime.getCached<ArticleDetail>("article:$articleId")
                ?: offlineReadStore.readArticleDetail(articleId)
            return@safeReadCall try {
                fetchAndStoreArticle(articleId)
            } catch (error: Exception) {
                stale ?: throw error
            }
        }

        // Fast path: in-memory hit. Instant.
        runtime.getCached<ArticleDetail>("article:$articleId")?.let { return@safeReadCall it }
```

`packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt:1023`:

```kotlin
                    if (response.conflict) {
                        localStore.rebaseReadStateMutation(mutation, response.revision)
                    } else {
                        val authoritative = response.read ?: mutation.read
                        localStore.acknowledgeReadStateMutation(
                            mutation,
                            authoritative,
                            response.revision,
                        )
                        runtime.getCached<ArticleDetail>("article:${mutation.articleId}")?.let { detail ->
                            runtime.putCached(
                                "article:${mutation.articleId}",
                                ARTICLE_DETAIL_TTL_MS,
                                detail.copy(isRead = authoritative),
                            )
```

`packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt:335`:

```kotlin
    suspend fun acknowledgeReadStateMutation(
        mutation: PendingReadStateMutationEntity,
        read: Boolean,
        revision: Int,
    ) {
        database.withTransaction {
            if (dao.deletePendingReadStateMutation(mutation.articleId, mutation.mutationId) > 0) {
                dao.updateArticleReadState(mutation.articleId, read)
                dao.readArticleDetail(mutation.articleId)?.let { entity ->
                    runCatching { articleDetailAdapter.fromJson(entity.payloadJson) }.getOrNull()?.let { detail ->
                        dao.upsertArticleDetail(
                            entity.copy(payloadJson = articleDetailAdapter.toJson(detail.copy(isRead = read))),
                        )
                    }
                }
                val existing = dao.readArticleStateRevision(mutation.articleId)
                dao.upsertArticleStateRevision(
                    ArticleStateRevisionEntity(mutation.articleId, revision, existing?.savedRevision),
                )
                dao.deleteAcknowledgedArticleReadOverride(mutation.articleId)
            }
        }
        notifyInvalidation(TABLE_ARTICLE_READ_OVERRIDES)
```

`packages/android/app/src/main/java/com/selffeed/android/data/ArticleStateSyncWorker.kt:33`:

```kotlin
        fun kickOnce(context: Context) {
            val request = OneTimeWorkRequestBuilder<ArticleStateSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabase.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/ArticleStateSyncWorker.kt`
- `packages/android/app/src/main/java/com/selffeed/android/SelfFeedApplication.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/SelfFeedRepositories.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/articles/ReadStateManager.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticlesViewModel.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/ArticleReadStateStore.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/ArticleStateSyncWorkerTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/WorkerSchedulingTest.kt`
- `packages/android/app/src/sharedTest/java/com/selffeed/android/data/WorkerSchedulingContract.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/data/WorkerSchedulingDeviceTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/local/LocalStoreTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/articles/ReadStateManagerTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/ArticlesViewModelTest.kt`
- This plan and its row in `plans/README.md`.

The additive article snapshot prerequisite below is the only API source expansion. Keep web behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `fix/android-offline-state-delivery` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| unit red | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleStateSyncWorkerTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest'` | The newly added reproduction fails on the specific pre-fix behavior; after implementation it passes. Existing unrelated tests remain green. |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleStateSyncWorkerTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest'` | All selected tests pass. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Prove a cache hit is independent of delivery

Seed real Room detail, feeds, and categories; suspend a mutation response while the connection reports online. Assert all cached reads complete without releasing that response. Add competing UI/worker drains and old-ack-after-new-intent cases for both read and saved state. Test a remote receipt while a newer local action is pending.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleStateSyncWorkerTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest'`. The newly added reproduction fails on the specific pre-fix behavior; after implementation it passes. Existing unrelated tests remain green.

### 2. Return local state before scheduling sync

Move outbox delivery out of cache-hit dependencies. Overlay pending local state before returning content. Start one serialized drain per session, using the owner from plan 035. Calls that mutate first commit durable intent and update UI; transport happens independently. Keep bounded retry/backoff and cancellation. Ensure worker scheduling cannot lose a newly enqueued mutation during an existing worker's completion.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleStateSyncWorkerTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest'`. All selected tests pass.

### 3. Publish the transaction's effective result everywhere

Have LocalStore return whether acknowledgement applied plus the effective state/revision when needed. Update memory, reader, list, search, and unread counts from that result. Raw SSE read values must not bypass pending overlays or regress known revisions. On terminal rejection restore the recorded prior state and emit one actionable result; on transient failure preserve the queued intent.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleStateSyncWorkerTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest'`. All selected tests pass.

### 4. Verify reconnect and worker completion ordering

Exercise bursts of alternating read/unread and save/unsave, process restart with real Room, simultaneous worker/UI triggers, conflicts requiring rebase, transient errors, and a new write arriving just as a drain finishes. Assert final Room, memory, UI, and server-fake state agree and the pending count reaches zero only after acknowledgement.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.data.ArticleStateSyncWorkerTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.ui.articles.ReadStateManagerTest' --tests 'com.selffeed.android.ui.ArticlesViewModelTest'`. All selected tests pass.

## Test and acceptance contract

- [x] Cached content returns while mutation transport is suspended.
- [x] At most one session drain delivers mutations at a time; queued work cannot become stranded in the enqueue/worker-completion race.
- [ ] A newer local mutation wins over an older acknowledgement or remote receipt until reconciliation completes.
- [ ] Read/save UI, cached detail, Room, and counts converge to the same effective state.
- [ ] Process restart preserves mutation IDs, ordering, and retryability without changing the server contract.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not remove mutation IDs/revisions or increase buffer sizes to hide races.
- If persistent schema shape changes are necessary, add an explicit forward migration, version increment, exported schema, and historical-path preservation tests in the same change; coordinate the version with plans 041/042.
- Do not swallow CancellationException in the drain or convert cancellation into a successful acknowledgement.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Future mutation consumers must use LocalStore's effective result. Keep one owner for delivery; adding another foreground flush call reintroduces the original latency problem.

## Execution notes

### Article snapshot prerequisite

At `5cc8b40`, three real Room cases reproduce older receipts lowering the known read/save revision and overwriting newer state (`/tmp/android-state-revisions-red.log`). Ordinary API list, detail and search responses contain flags but omit the existing `article_user_states` revisions. Android cannot order those snapshots against mutation responses or realtime receipts.

Add a separate `feat/article-state-snapshots` PR before Android reconciliation. Expand scope to the API article repository/search queries and `article-read.persistence.ts`, article service and cache model/service, unused Redis membership keys, article routes/ETags, shared article response contracts, OpenAPI source/generated document, and focused unit/integration tests. Return read/save revisions with their flags in one SQL snapshot. Keep mutation endpoints and persistent schemas unchanged.

Redis supplies cached content; one bounded SQLite query supplies current flags, revisions and ownership on each cache hit. It covers only returned IDs (at most 100 for a cached page, one for detail) and uses existing indexes. Remove the redundant cached boolean patches and membership indexes. This handles stale warmers, bulk changes, legacy payloads and other API writers without a second state authority. Missing owned rows cause detail 404 or normal scoped list-query fallback. Keep content invalidation and existing cache namespaces/expiry. Cache writes omit revision metadata so older processes cannot forward revision fields while patching only flags. Test actual SQLite, disposable Redis and HTTP validators. No service deployment or live data access is authorized.

The supporting PR also limits Biome's input to authored application files by excluding Android's generated Room schema directory and the intentionally malformed publisher-HTML fixture directory. Room schema validation/migration tests and Android fixture checks remain required. No production source lint rule is relaxed.

Android will accept absent revision metadata from older servers as unknown. It must not reinterpret absence as revision zero or let an unversioned snapshot supersede known newer state. Existing cached content remains readable.

- Reconciled commit: `25f7a0e`. Main already fixes cached article reads and serializes drains/acknowledgement publication. PR #58 adds structured cached subscription streams. PR #59 owns full worker execution and keeps existing startup work. Remaining delivery work is legacy subscription read/invalidation flushes, synchronous read/save delivery, per-action REPLACE and confirmed outbox authentication rejection. Effective rejection/count persistence follows as a separate review slice.
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending

### Delivery slice

The first three reproductions fail in `/tmp/android-outbox-delivery-red.log`: cached subscription reads wait for an existing delivery, read/save actions perform transport on their caller, and a burst replaces pending WorkManager requests. Cached reads/invalidation now stay independent of delivery. Read/save accepts durable Room intent and performs only a short local scheduling handoff before returning; ordinary lifecycle cancellation still propagates from the enclosing owner scope.

Scheduling queries unfinished work only. Existing queued/blocked attempts coalesce. A running attempt gets one successor through APPEND_OR_REPLACE; an empty unfinished set uses KEEP to remove completed-chain history. Delivery stays serialized, and explicit drains now use normal authenticated error handling. A confirmed authentication rejection archives the old queue and clears its owner instead of escaping the normal auth-loss path.

Independent review reproduced a manual-retry lock wait (`/tmp/android-outbox-retry-lock-red.log`) and completed-chain growth (`/tmp/android-outbox-history-red.log`, expected one named row, found three). Both are corrected. The shared WorkManager contract runs repeated queued bursts, edits during a finishing worker and completed delivery cycles on JVM and Android.

All 518 JVM tests and both isolated APK pairs pass in `/tmp/android-outbox-isolated-build.log`. Combined testing exposed a work-testing fixture leak: `closeWorkDatabase()` closes Room but leaves its static test delegate installed. The fixture now undoes that restricted test hook in cleanup; production cancellation handling is unchanged. Final lint passes in `/tmp/android-outbox-final-lint.log`; Android results are below. Durable unread-count reconciliation, effective rejection publication, and mutation recovery after actual process death remain subsequent plan 036 work.

All seven selected Android checks pass in `/tmp/android-outbox-device.log`: the three shared WorkManager contracts run on actual Android, alongside the four foreground/cached-subscription lifecycle checks. The test-only worker controls completion; repository mutation behavior uses real Room with a controlled API in JVM tests. This is not a claim that a device test exercised end-to-end server delivery.


The snapshot prerequisite passes actual SQLite reads, Redis cache-hit authority and HTTP validators, including mixed-version payload safety. Review findings were reproduced and resolved. Full final API integration: 138 passing; API unit: 734 passing with 32 affected cases repeated after the last payload-format change; web unit: 403 passing; all package types, repository lint/architecture and web production build pass. The added cache-hit query is bounded to returned article IDs; physical Android performance remains unrelated and pending. Android Room/UI reconciliation and durable counts remain incomplete.
