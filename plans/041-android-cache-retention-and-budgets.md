# Plan 041: Bound cache maintenance and protect retained offline content

- Status: TODO
- Priority: P1
- Effort: L
- Implementation risk: MED
- Category: migration
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [035](035-android-session-and-request-lifecycle.md), [036](036-android-cache-first-and-mutation-authority.md), [037](037-android-main-safe-io.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabase.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabaseMigrations.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/local/OfflineReadStore.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/MemoryCache.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/RepositoryRuntime.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt' 'packages/android/app/src/main/java/com/selffeed/android/data/repository/SelfFeedRepositories.kt' 'packages/android/app/src/main/java/com/selffeed/android/SelfFeedApplication.kt' 'packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt' 'packages/android/app/schemas/' 'packages/android/app/src/test/java/com/selffeed/android/data/local/LocalDatabaseMigrationTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/local/LocalStoreTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/MemoryCacheTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidCacheLifecycleUiTest.kt'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

Every article write reparses the expired saved archive inside a transaction. Memory caching uses entry counts, and ordinary detail storage has no byte budget. Add cheap, queryable retention metadata and bounded maintenance while preserving the app's saved-content promise and queued mutations.

## Current state and conventions

Planning baseline uses Room version 7 with explicit migrations through 6->7, including an early version-6 saved_articles layout. Saved article bodies currently survive the normal seven-day age limit. LocalStore is the production offline store; legacy OfflineCacheStore is not the current binding. Budget disposable cache separately from saved/downloaded content. Session ownership from plan 035 and mutation overlays from plan 036 are prerequisites.

`packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt:452`:

```kotlin
    override suspend fun writeArticleDetail(detail: ArticleDetail) {
        database.withTransaction {
            val stored = detail.copy(
                isRead = dao.readPendingReadStateMutation(detail.id)?.read ?: detail.isRead,
                isSaved = dao.readPendingSavedStateMutation(detail.id)?.saved ?: detail.isSaved,
            )
            dao.upsertArticleDetail(
                ArticleDetailEntity(
                    id = stored.id,
                    feedId = stored.feedId,
                    payloadJson = articleDetailAdapter.toJson(stored),
                    writtenAt = System.currentTimeMillis(),
                ),
            )
            for (expired in dao.readExpiredArticleDetails(System.currentTimeMillis() - MAX_ARTICLE_DETAIL_AGE_MS)) {
                val cached = runCatching { articleDetailAdapter.fromJson(expired.payloadJson) }.getOrNull()
                if (cached?.isSaved != true) dao.clearArticleDetail(expired.id)
            }
```

`packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt:508`:

```kotlin
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

`packages/android/app/src/main/java/com/selffeed/android/data/MemoryCache.kt:93`:

```kotlin
    private fun prune() {
        val now = nowMs()
        val expiredKeys = entries.entries
            .filter { (_, entry) -> entry.expiresAtMs < now }
            .map { it.key }
        expiredKeys.forEach { key ->
            entries.remove(key)
            locks.remove(key)
        }

        if (entries.size <= maxEntries) return

        val overflow = entries.size - maxEntries
        entries.entries
            .sortedBy { it.value.lastAccessMs }
            .take(overflow)
            .forEach { (key, _) ->
                entries.remove(key)
                locks.remove(key)
```

`packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabaseMigrations.kt:6`:

```kotlin
const val LOCAL_DATABASE_VERSION = 7
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabase.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalDatabaseMigrations.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/LocalStore.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/local/OfflineReadStore.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/MemoryCache.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/RssRepository.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/RepositoryRuntime.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/FeatureRepositories.kt`
- `packages/android/app/src/main/java/com/selffeed/android/data/repository/SelfFeedRepositories.kt`
- `packages/android/app/src/main/java/com/selffeed/android/SelfFeedApplication.kt`
- `packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt`
- `packages/android/app/schemas/`
- `packages/android/app/src/test/java/com/selffeed/android/data/local/LocalDatabaseMigrationTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/local/LocalStoreTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/MemoryCacheTest.kt`
- `packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidCacheLifecycleUiTest.kt`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `perf/android-cache-retention` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.data.MemoryCacheTest' --tests 'com.selffeed.android.data.RssRepositoryTest'` | All selected tests pass. |
| migration | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest'` | Clean creation and every supported migration path pass with preserved fixture data. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidCacheLifecycleUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Measure and specify the retention policy

Use synthetic archives with 100 and 5,000 old saved bodies and several large documents. Count rows/bytes decoded during a new detail write and measure transaction time outside strict timing assertions. Specify disposable-body, saved-body, active-reader, pending-mutation, and media-reference protection rules. Choose measured conservative default budgets for disposable data; expose policy values through typed configuration. Saved content is preserved when over budget, with capacity reported rather than silent eviction.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.data.MemoryCacheTest' --tests 'com.selffeed.android.data.RssRepositoryTest'`. All selected tests pass.

### 2. Add metadata with a forward migration

At execution, use the next unused schema version after all dependencies, not a hard-coded reuse of version 7. Store queryable byte size, retention/protection and access/availability metadata needed to avoid full JSON scans. Backfill existing rows conservatively, preserving saved state from both body and article/pending overlays; handle malformed payloads without discarding existing data. Export the new schema. Extend tests from every supported historical schema and both version-6 layouts through the new current version, plus clean creation.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest'`. Clean creation and every supported migration path pass with preserved fixture data.

### 3. Move cleanup away from the write hot path

Use indexed bounded candidate queries and chunked eviction of disposable records, scheduled separately from every detail write. Enforce byte-aware memory limits while maintaining an entry limit as a secondary safeguard. Avoid repeated access-time writes on every frame. Do not clear active reader data or files referenced by retained downloads/pending changes. Leave media-file orphan sweeping to plan 042 after it establishes explicit resource ownership and references. Do not delete files inside Coil's managed cache directly; use its supported cache operations.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.local.LocalDatabaseMigrationTest' --tests 'com.selffeed.android.data.local.LocalStoreTest' --tests 'com.selffeed.android.data.MemoryCacheTest' --tests 'com.selffeed.android.data.RssRepositoryTest'`. All selected tests pass.

### 4. Verify pressure, corruption, and archive growth

Test budget exhaustion, low storage/write failure, a corrupt cached body, interrupted cleanup, and memory trim while reading. Existing saved content stays available; a failed new cache write never presents a false availability flag. Record archive-growth cost and repeated reader open/close memory after garbage-collection stabilization without demanding an unrealistic immediate RSS drop.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidCacheLifecycleUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

## Test and acceptance contract

- [ ] Every persistent schema change has a distinct version, exported schema, and explicit migration.
- [ ] Clean creation and all supported historical upgrades preserve saved bodies, article rows, preferences, read/save mutations, revisions, and session access.
- [ ] Writing one detail no longer reparses the entire expired saved archive.
- [ ] Disposable memory/disk use obeys documented measured budgets; retained content is not silently removed when those budgets are exceeded.
- [ ] Cleanup resumes safely after interruption and availability reflects successfully persisted readable content.
- [ ] Storage failures degrade to readable existing content and actionable failure without crashing or clearing databases.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Never use destructive migration fallback, reset app data, edit an old exported schema, or publish two schemas under one version.
- A size budget does not authorize deleting saved/downloaded articles. Keep them protected until a user explicitly removes the retained content.
- If the historical fixture cannot be migrated losslessly, preserve it and resolve the migration before proceeding to plan 042.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

New cached resources must declare ownership, byte accounting, and eviction eligibility. Keep schema-writing plans serialized; plan 042 follows this plan's actual resulting schema version.

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
