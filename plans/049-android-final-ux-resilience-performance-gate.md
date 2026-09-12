# Plan 049: Validate the complete Android experience on isolated targets

- Status: TODO
- Priority: P1
- Effort: L
- Implementation risk: LOW
- Category: tests
- Planned at: `74d5c11`, 2026-09-11
- Depends on: [033](033-android-review-verification-foundation.md), [034](034-android-design-and-motion-selection.md), [035](035-android-session-and-request-lifecycle.md), [036](036-android-cache-first-and-mutation-authority.md), [037](037-android-main-safe-io.md), [038](038-android-loading-and-error-lifecycle.md), [039](039-android-media-and-reader-resource-lifecycle.md), [040](040-android-reader-readiness-and-fallback.md), [041](041-android-cache-retention-and-budgets.md), [042](042-android-durable-offline-downloads.md), [043](043-android-reading-session-restoration.md), [044](044-android-reader-idle-and-long-article-performance.md), [045](045-android-dense-queue-and-search.md), [046](046-android-adaptive-reader-and-motion.md), [047](047-android-feed-settings-and-draft-resilience.md), [048](048-android-realtime-gap-recovery.md)

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/TESTING.md' 'packages/android/ARCHITECTURE_TASKS.md' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidExperienceAcceptanceUiTest.kt' 'packages/android/app/src/androidTest/assets/android-review/' 'packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/' 'packages/android/app/src/release/generated/baselineProfiles/' 'scripts/android-review-device.sh' 'scripts/android-review-benchmark.sh' 'plans/android-review/acceptance.md' 'scripts/android-review-process.sh'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

A collection of passing unit tests does not establish offline rendering, media pause, loading continuity, process recovery, or physical performance. Validate the final integrated behavior, preserve migration safety, and record measured results before claiming this Android improvement batch is complete.

## Current state and conventions

Use the verified wrappers and fixture dataset from plan 033. Existing scripts/android-check.sh runs Android/OpenAPI compatibility, unit tests, instrumentation compilation, lint, debug/release builds, and R8 verification with an example.invalid release endpoint. It does not prove runtime behavior. Numeric performance thresholds remain manual/device-specific under the repository architecture decision. Prior plans 008/021/032 contain deployment instructions for old batches and do not authorize deployment for this batch.

`packages/android/TESTING.md:3`:

```text
The Android client uses JUnit 4, kotlinx-coroutines-test, MockK, Robolectric Compose tests, and Compose instrumentation tests. Instrumentation targets the isolated `deviceTest` application ID so it does not replace or clear the normal installed app.

## Test layers

- Pure unit tests cover repositories, ViewModels, state reducers, prefetching, and read-state behavior.
- Robolectric Compose tests cover component rendering and interaction regressions without requiring a device.
- Instrumented Compose tests cover complete user journeys on an emulator or physical device.
```

`packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/StartupBenchmark.kt:36`:

```kotlin
    @Test
    fun coldStartup() = benchmarkRule.measureRepeated(
        packageName = TARGET_PACKAGE,
        metrics = listOf(StartupTimingMetric(), FrameTimingMetric()),
        compilationMode = CompilationMode.Partial(),
        startupMode = StartupMode.COLD,
        iterations = 5,
        setupBlock = {
            pressHome()
        },
    ) {
        startActivityAndWait()
        device.waitForIdle()
    }
```

`packages/android/app/src/main/java/com/selffeed/android/ui/BenchmarkReaderScenario.kt:111`:

```kotlin
        if (selectedArticle != null) {
            Text(
                text = "Reader ready",
                modifier = Modifier
                    .semantics { contentDescription = BenchmarkReaderReadyDescription }
                    .padding(16.dp),
            )
        }
```

`packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticleReaderFastSwipeE2eTest.kt:61`:

```kotlin
                            // This regression verifies prefetched page transitions using
                            // Compose-visible reader text; Rich-mode WebView rendering is
                            // covered separately by MainActivityHiltUiTest.
                            preferHtml = false,
                        )
```

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/TESTING.md`
- `packages/android/ARCHITECTURE_TASKS.md`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidExperienceAcceptanceUiTest.kt`
- `packages/android/app/src/androidTest/assets/android-review/`
- `packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/`
- `packages/android/app/src/release/generated/baselineProfiles/`
- `scripts/android-review-device.sh`
- `scripts/android-review-benchmark.sh`
- `plans/android-review/acceptance.md`
- `scripts/android-review-process.sh`
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `test/android-experience-acceptance` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |
| full | `mise exec -- bun run android:check` | The existing Android contract, unit, instrumentation compilation, lint, debug/release assembly, and R8 checks pass in the isolated checkout. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidExperienceAcceptanceUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| process | `bash scripts/android-review-process.sh 'com.selffeed.android.macrobenchmark.OfflineDownloadProcessTest,com.selffeed.android.macrobenchmark.ReadingSessionProcessTest,com.selffeed.android.macrobenchmark.QueuedMutationProcessTest'` | The separately hosted test runner survives target death; all selected recovery journeys pass with verified old/new target PIDs and persisted state. |
| benchmark | `bash scripts/android-review-benchmark.sh --serial "$ANDROID_REVIEW_SERIAL" --output packages/android/build/review-performance` | Release-equivalent physical-device results and metadata are written; inspect the predeclared comparison and memory limits. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |

## Implementation steps

### 1. Reconcile all plans and freeze acceptance conditions

Verify dependencies' actual outcomes and link every review requirement to a passing test or a named manual check. Record device models, Android/WebView versions, build/commit, refresh rate, animation scale, fixture size, cache state, and fault schedule. Compare the integrated implementation to the selected mocks. Define comparison tolerances from plan 033's baseline before collecting final measurements.

Verify with `git diff --check && git status --short`. No whitespace errors; every changed path belongs to this plan's scope.

### 2. Run complete static, build, and migration gates

In the isolated checkout with the repo-pinned toolchain, run mise exec -- bun run android:check and the final migration tests. Confirm every supported old schema including both version-6 layouts reaches the current schema without losing retained articles, sessions, or pending changes. Verify release schema/version output and packaged Baseline Profile. Do not relax checks or rewrite historical schema fixtures to obtain green results.

Verify with `mise exec -- bun run android:check`. The existing Android contract, unit, instrumentation compilation, lint, debug/release assembly, and R8 checks pass in the isolated checkout.

### 3. Run end-to-end failure and recovery journeys

Use real Room and WebView with local controlled transport. Cover cached open with hung writes; save/restart/offline image rendering; process death during download and queued mutation; playback/swipe/tab/background/fullscreen/close; delayed response after Back/account switch; old ack after new action; multi-revision refresh continuity; search failure and offline scope; editor failure/retry/recreation; low storage, corrupt cache, and renderer process loss. Use focused component tests from their owner plans rather than duplicating every assertion in one enormous smoke test.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidExperienceAcceptanceUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 4. Verify interruption in an external runner

Run the separate-process recovery classes from plan 033, including completed/partial offline preparation, reading-context restoration, and a queued mutation interrupted before acknowledgement. Use production Room/repository and local controlled transport. Record that the target's old PID died, the runner remained alive, the restored target has a new PID, pending intent survived, and duplicate retries converge. Do not use the app-targeted instrumentation command for killing its own process.

Verify with `bash scripts/android-review-process.sh 'com.selffeed.android.macrobenchmark.OfflineDownloadProcessTest,com.selffeed.android.macrobenchmark.ReadingSessionProcessTest,com.selffeed.android.macrobenchmark.QueuedMutationProcessTest'`. The separately hosted test runner survives target death; all selected recovery journeys pass with verified old/new target PIDs and persisted state.

### 5. Measure final performance and accessibility

Run the isolated release-equivalent physical benchmark for initial display and actual readable body, cached/uncached opens, long-list scroll, rapid rich swipes, idle CPU/callback activity, and repeated open/close memory. Compare the same device/dataset/network conditions to baseline. Check 60/120Hz where available, phone/tablet/multi-window/large text, keyboard/TalkBack, and disabled motion. Generate the final Baseline Profile in a dedicated emulator, verify it covers body readiness and reader interactions, and validate packaging. After generating or changing the profile, rerun mise exec -- bun run android:check to rebuild the release artifacts, inspect the rebuilt APK's packaged baseline.prof/baseline.profm and profile generation report, and rerun the isolated benchmark against the rebuilt candidate. The acceptance record must identify the final profile commit and rebuilt artifact hashes; an earlier packaging check cannot validate newly generated profile contents.

Verify with `bash scripts/android-review-benchmark.sh --serial "$ANDROID_REVIEW_SERIAL" --output packages/android/build/review-performance`. Release-equivalent physical-device results and metadata are written; inspect the predeclared comparison and memory limits.

### 6. Publish a local acceptance record

Write plans/android-review/acceptance.md with exact commands, tested commit, results, artifact paths, before/after measurements, selected designs, residual limits, and any unverified hardware cases. Update architecture/testing docs to match delivered behavior. Mark individual rows DONE only when their gates pass. Finish by reporting readiness and remaining limitations to Gustavo; no push, release, deployment, or normal-app install is included.

Verify with `git diff --check && git status --short`. No whitespace errors; every changed path belongs to this plan's scope.

## Test and acceptance contract

- [ ] All implementation plans are DONE, or an explicit user-approved deferral is recorded as an incomplete part of the original scope rather than silently counted as completion.
- [ ] The full Android gate, migration matrix, and isolated instrumentation pass for the recorded integrated commit.
- [ ] The user's loading, offline, context-cleanup, and media-pause requirements each have direct runtime evidence.
- [ ] Physical release measurements cover actual reader readiness and show no unexplained material regressions versus the frozen baseline.
- [ ] Memory/live-renderer counts settle after repeated cycles and stationary readers stop app-controlled animation/observer work.
- [ ] Selected layouts pass the accessibility/viewport/motion matrix; real provider limitations are stated honestly.
- [ ] The local acceptance report links results and reproducible commands without personal data or credentials.
- [ ] Final release verification and physical measurements refer to artifacts rebuilt after the last Baseline Profile change.
- [ ] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [ ] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [ ] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not run scripts/verify-android-release-startup.sh against a daily-driver device; use the isolated performance target and guarded wrapper.
- If an integrated failure is found, return it to the owning plan and amend its scope there rather than making broad fixes under this validation plan.
- Missing physical hardware, mock selection, or runtime evidence leaves the relevant acceptance item pending. Do not label emulator/debug numbers as physical release performance.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Keep this acceptance set focused on durable user journeys. Update baseline and profile deliberately when content fixtures or rendering architecture change, and preserve a comparable previous result.

Reference documentation to verify against the installed versions:

- [Reference 1](https://developer.android.com/develop/ui/compose/performance)
- [Reference 2](https://developer.android.com/topic/performance/baselineprofiles/create-baselineprofile)

## Execution notes

- Reconciled commit: pending
- Reproduction and checks: pending
- Device/performance evidence: pending where applicable
- Design selection: pending where applicable
- Remaining limitations: pending
