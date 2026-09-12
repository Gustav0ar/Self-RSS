# Plan 036: Return cached content immediately and preserve the latest mutation

- Status: DONE, implementation and scoped acceptance; integrated release evidence remains plan 049
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
- `packages/android/app/src/main/java/com/selffeed/android/network/ApiModels.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabaseMigrations.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/ArticleStateReconciliation.kt`
- `packages/android/app/schemas/com.selffeed.android.data.local.LocalDatabase/9.json`
- `packages/android/app/src/sharedTest/java/com/selffeed/android/data/local/LocalDatabaseMigrationContract.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/RepositoryAccountOwnershipTest.kt`
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
- [x] A newer local mutation wins over an older acknowledgement or remote receipt until reconciliation completes.
- [x] Read/save UI, cached detail, Room, and counts converge to the same effective state.
- [x] Process restart preserves mutation IDs, ordering, and retryability without changing the server contract.
- [x] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [x] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [x] `git diff --check` passes and scope review finds no unrelated changes.
- [x] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

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


### Android confirmed-state reconciliation

The Room 9 change will retain the last confirmed read/save value with its existing revision, independently of the pending local overlay. It must preserve all old columns, archived queues and cached bytes, including both version-6 paths. Unknown legacy confirmed values remain nullable until existing metadata/body or a versioned response can establish them. Ordinary snapshots from older servers remain readable but cannot lower a known revision. Conflict/ack/rejection updates must match the captured mutation ID, retain newer intent and publish the effective local state. This slice does not complete durable counts or final UI command ordering.

Review found that schema 8 flags and revisions do not always describe the same response: old unversioned writes could replace flags while preserving revisions. Migration 8 to 9 therefore leaves confirmed values unknown for every existing nonnull revision. Existing unversioned metadata may seed a value; a missing prior state remains unknown. Once initialized, unknown records are never rehydrated from a rejected optimistic projection. Matching rejection reports removal independently of whether a safe rollback value exists. Bulk events without article revisions preserve known versioned state and act as refresh hints.

The reconciliation implementation uses the local database as state authority and leaves delivery with WorkManager, consistent with [Android's offline-first guidance](https://developer.android.com/topic/architecture/data-layer/offline-first). The added snapshot checks skip unchanged or stale state before reading full cached bodies. A real Room query callback test covers twenty large cached bodies, and a loaded PagingSource test verifies rejected stale search metadata does not invalidate it. Bulk initialization reuses one-time baseline recovery so legacy queued bookmarks are not readmitted as confirmed flags.

All 538 JVM tests pass in `/tmp/android-confirmed-state-final-build.log`; lint, APK builds and device migrations are still running. The exported Room 8 schema remains byte-identical. This slice covers Room/repository reconciliation. UI command ordering, permanent read-rejection publication, authoritative refresh after a versionless bulk hint, durable unread counts, and queued mutation recovery after actual process death remain separate plan 036 work. Main-safe body preparation and cache budgets remain plans 037/041.

Final validation for the Room/repository slice passes: all 538 JVM tests, Android lint and both isolated APK pairs in `/tmp/android-confirmed-state-final-build.log`; all 30 selected emulator tests in `/tmp/android-confirmed-state-device.log`. The shared migration contract runs on API 36.1 and covers clean creation, every supported starting version, historical version-6 preservation, and the schema-8 mismatched-state fixture. Independent source review is complete. These checks do not establish physical memory or frame-time budgets.

### Article action and durable-count follow-up

At `6fe1f8f`, delayed save failure, single read receipt, and own bulk completion overwrite a newer visible local choice in `/tmp/android-article-actions-red.log`. The first command/event gate changes pass focused tests, but this slice is not ready for publication. Count arithmetic still depends on the order of UI callbacks; moving old callbacks out of the UI requires durable count publication in the same slice. Latest failure/rejection also needs a local-state read rather than an older optimistic rollback value.

Use conservative aggregate admission with the current API. Persist each effective local read transition and its count delta in the same transaction as the outbox update. Keep stored counts while pending reads exist. Capture a durable local count epoch before network snapshots, and reject their count fields if the epoch changes or pending reads span the request. Gate every writer, including legacy and background paths, before Room publication. Metadata may refresh independently. Publish complete durable counts to the UI and remove duplicate event arithmetic. Preserve search-only feed membership, nested category counts and a durable stats snapshot. Existing legacy counts remain last-known values; this does not claim globally fresh counts during unsettled delivery.

Expand scope for that dependency to `LocalCountStore.kt`, Room schema 10 plus migration 9 to 10, `LocalCountStoreTest.kt`, the existing migration contract, `UnreadStateReducer.kt`, `FeedsViewModel.kt`, `SettingsViewModel.kt`, `ArticleFeatureEventCoordinator.kt`, repository interfaces/facades, their focused tests and the existing app event wiring. The new schema must preserve all prior schemas and test both historical version-6 paths. No API deployment or live data access.

Room 10 also records the count scope actually adjusted by each pending read. Replacement/rebase keep it, while old unknown scopes remain inert. Keep signed totals in storage and clamp only display values so a read/rejection round trip at zero is reversible. Raw metadata merges/reorders must not write clamped values back. Serialize remote reads of the same kind and capture the count ticket inside that serialization. The foreground observes durable count generation/pending changes to request coalesced freshness after delivery or remote hints; writing stats must not trigger another request.

The same follow-up adds a bounded reader publication check because delayed open, warming and enrichment results can arrive after a bookmark action has already completed. Expand scope to the existing warming/enrichment callbacks and their focused tests. Keep the current stored flag, overlay active UI intent, serialize publications and recheck action generation plus request ownership after the local read. Rejection events carry captured mutation IDs and read current local state before presenting a rollback or error. Do not retain an unbounded map of completed UI actions.

Remaining after this slice: versioned catch-up after bulk hints, replacing stale buffered flag-event publication with current local state, and actual process-death mutation recovery. Preserve these as explicit follow-up work; do not mark plan 036 complete based on count tests alone.

Final action/count validation passes 566 JVM tests, Android lint, both isolated APK pairs and all 51 selected API 36.1 emulator checks. Shared count contracts run on real Android SQLite as well as Robolectric, including reopen, lost acknowledgment, zero-baseline rollback, metadata admission, rebase and foreground refresh behavior. Migration tests cover every supported history and clean creation; schemas 8 and 9 are unchanged. Evidence: `/tmp/android-actions-counts-final-build-2.log` and `/tmp/android-actions-counts-device.log`. Independent source review found no new blockers. Plan 036 remains in progress for the follow-ups above.

### Bounded state lookup prerequisite

The existing API `ArticleRepository.findStatesForUser` already selects current flags and paired revisions in one owned SQLite query without article bodies. Expose it through an authenticated `POST /articles/states` accepting 1 to 100 UUIDs, with the existing article-read rate limit. Deduplicate validated IDs and return owned rows plus `missingIds`; missing covers absent and unowned articles uniformly. Do not invent false flags, disclose ownership, or delete offline data from that result.

Expand this separate PR to shared article validation/response contracts, the article service/routes, OpenAPI source/generated output and real HTTP/SQLite integration tests. No schema change is needed. Android consumption follows in its own PR, with one foreground-owned conflated refresh, actual cancellation and the existing account commit boundary. Refresh on bulk hints, reconnect/resume and newly visible IDs. Preserve a wake that arrives during a request and retain Room state on failure.

The API prerequisite also adds the matching typed Retrofit transport and Moshi request/response models, plus OpenAPI contract mappings. This keeps Android endpoint coverage checked without an unsupported-operation exception. UI/repository consumption remains in the next slice.

The bounded lookup passes 143 full API integration cases, 734 API unit cases, all package types, repository lint/architecture and Android/OpenAPI mapping. Android validation passes 567 JVM tests, lint and both isolated APK pairs. The endpoint is read-only and requires no persistent migration. Logs use `/tmp/article-state-lookup-`; independent source review found no blockers. Android UI consumption remains pending.

### Observable article state prerequisite

Add one owner-filtered local query joining confirmed read/save state and both pending overlays for the requested IDs. It must include pending-only legacy rows, preserve nullable unknown values, run off Main and avoid article body decoding. Each SQL/request batch contains at most 100 IDs. One Room transaction assembles each emitted map, and empty input does no storage work. This does not add joins to the Paging query.

Retained last-mutation IDs identify the logical local choice and must survive transport rebasing. A matching discard returns that logical ID with its nullable restored value; obsolete discard returns no rejection. This changes no persistent schema shape. UI action receipts and retirement of the old flag event pipeline remain a following integration slice.

Add repository/remote/facade batch lookup support using the existing account boundary and projection mutex. Validate the response at the network boundary: nonnegative paired revisions, unique returned/missing IDs, and an exact partition of the requested batch. Reject malformed batches before any state write; keep queued edits, missing article bodies and previous state on errors. Refresh commits versioned pairs through existing reconciliation and updates only affected cached details. A changed known flag may still invalidate an existing content PagingSource through the current article table; removing that storage coupling belongs with the complete UI projection/retention work and is not claimed by this prerequisite.

Scope includes existing Room/repository/remote/facade sources, `LocalArticleObservationContract.kt` with JVM/device wrappers, and focused repository/account tests. Test ownership replacement and cancellation, pending overlays, rebased rejection identity, large input chunking, missing IDs, invalid response atomicity and stale revisions. Preserve schemas 8–10 byte-for-byte.

- Observable-state foundation validation: 577 JVM tests, lint and both isolated APK pairs pass in `/tmp/android-observed-state-build.log`. All 36 selected API 35 device checks pass in `/tmp/android-observed-state-device.log`, including the new Room observation contract, durable counts, every supported migration and repeated fullscreen/background lifecycle. The original retry-identity case failed before the change in `/tmp/android-observed-state-red.log`. Two independent source reviews found no blockers. Generated Room SQL uses 401 binds for each 100-ID chunk and all chunks share one transaction. Exported schemas 8–10 are unchanged. UI consumption, removal of buffered flag authority, actual bulk catch-up and process-death outbox recovery remain pending.

### Room-driven presentation integration

- Base: `1fc74a2`, PR #65. Root owns production/test files and builds. Read-only review remains independent.
- Replace article/read/save/scope boolean events and the permanent session read override map with a bounded Room projection. Keep events as content/freshness hints and transient rejection feedback.
- Queue actions return the durable logical mutation receipt. Optimistic values last only until a matching committed Room receipt is observed, survive response/flow ordering, and cannot overwrite a newer action or remote revision. The projection releases values for IDs no longer needed by the visible list, bounded search results, nearby reader documents, or an in-flight action.
- Observe visible list IDs and the existing bounded search result set, plus selected/nearby reader IDs. Foreground ownership cancels Room and refresh work at STOP; explicit user action persistence retains ViewModel ownership. A new window, resume, reconnect or bulk receipt requests bounded catch-up. Conflate requests arriving during catch-up and preserve one successor without cancel/restart starvation. Unsupported state endpoints keep the existing content and wait for another meaningful trigger.
- Scope extends to `ui/SelfFeedApp.kt`, `ui/SelfFeedAppRoute.kt`, `ui/ArticleFeatureEventCoordinator.kt`, `ui/AppWorkflowCoordinator.kt`, `ui/SearchViewModel.kt`, `ui/screens/ArticlesTab.kt`, and a small `ui/articles/ArticleStateProjection.kt`, with matching existing/new unit and device tests. Changes are mechanical state plumbing and keep the existing visual layout.
- Do not mark the full plan complete until actual queued mutation process-death recovery also passes. Paging row invalidation, storage retention, long reader queues and renderer resource measurements remain explicitly tracked in later plans.

- UI integration removes buffered read/save/scope payload authority, the permanent override store and Paging's once-per-generation override snapshot. Queue and Search render the same bounded flag map. The reader overlays current flags when late content is published. Local writes return logical receipts, with observation tokens rejecting callbacks from retired windows, foreground lifetimes and clear/revisit cycles.
- Explicit refresh, reconnect, unversioned events and unknown matching rejections reopen Room observation and request revisioned state. One conflated loop retains one successor during an active lookup; failed reads wait for a meaningful trigger. The scope covers 100 visible/fallback rows, 80 Search results, up to 20 retained reader details, the selected article and unfinished submissions. Ordinary flag changes do not recreate the Pager or remap all accumulated content rows.
- A bounded pre-action display fallback handles unknown stored flags without inventing confirmed Room values or revision bases. It survives replacement actions/pending acceptance, yields to known Room state, updates for a later independently confirmed choice and disappears when the article leaves retention.
- Guidance checked against [Android lifecycle-aware coroutine collection](https://developer.android.com/topic/libraries/architecture/coroutines), [offline-first architecture](https://developer.android.com/topic/architecture/data-layer/offline-first) and [asynchronous Room queries](https://developer.android.com/training/data-storage/room/async-queries). Foreground structured collection and observable local authority follow those contracts; source inspection alone does not prove native memory stability.

- Final presentation validation passes 582 JVM tests, lint, both isolated APK pairs and 34 affected API 35 device cases. The complete 117-case device suite passed before the final scheduling/prefetch boundary changes. Durable receipts now return after Room admission; optional image prefetch and WorkManager enqueue run in the injected application scope and cannot turn an accepted edit into a UI failure. Startup KEEP scheduling recovers the persistence-to-enqueue crash window. Two controlled tests reproduced the old boundary failures, and independent read-only review found no new ownership/enqueue race. Evidence and the two unexplained earlier JVM stalls are recorded in the progress log. Actual queued mutation process-death acceptance remains unchecked.

### External outbox recovery acceptance

Base `5ca7ed1` (#66). Extend the existing performance-only Room fixture and external process runner to queue real repository read/save actions against a server bound only to 127.0.0.1 in the runner process. Keep acknowledgments unavailable before and immediately after confirmed background process death, verify persisted owner/content/mutation IDs, then allow production WorkManager delivery and verify confirmed revisions plus empty queues. The fixture server models a lost read acknowledgment using idempotent mutation IDs; it never contacts the API service. Scope adds the performance-only Activity/manifest/network security resource, macrobenchmark test server/runner/dependency and this execution record. The normal/release network policy remains unchanged. No production code or schema change is planned.

Final external recovery passes both cases on the isolated API 35 emulator in `/tmp/android-outbox-process-final.log`, including exact body bytes, a changed target PID, unchanged account owner/receipts, original WorkManager retry recovery and confirmed Room state. The server applies each logical mutation once and records the retried read ID. Independent review found fixture-readiness, missing body assertions and teardown gaps; all are corrected. Performance-target lint passes in `/tmp/android-outbox-process-final-lint.log`; the runner test module has no lint task, as verified by its task list. No production source/schema changed in this acceptance slice. Plan 036 scoped behavior is complete; the unexplained WebView failures and physical performance/memory acceptance remain plan 049.
