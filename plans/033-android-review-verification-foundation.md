# Plan 033: Establish isolated Android behavior and performance fixtures

- Status: IMPLEMENTED (physical performance evidence pending)
- Priority: P1
- Effort: M
- Implementation risk: LOW
- Category: tests
- Planned at: `74d5c11`, 2026-09-11
- Depends on: none

## Start here

Implementation and separate review PRs are authorized by Gustavo. Merging and deployment are not authorized. Run commands from the repository root, `/home/gustavo/Code/personal/apps/rss-app`, or the root of an isolated checkout. Read this plan completely and keep execution notes here. The review was source-based; device behavior and performance were not measured during planning. Reproduce the named failure before calling it fixed.

Run `git status --short`, `git rev-parse --short HEAD`, and the following drift check:

```bash
git diff --stat 74d5c11..HEAD -- 'packages/android/app/src/androidTest/java/com/selffeed/android/data/FakeSelfFeedRepository.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/di/TestRepositoryModule.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidReviewFixtureUiTest.kt' 'packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticleTabTestHarness.kt' 'packages/android/app/src/androidTest/assets/android-review/' 'packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/AndroidReviewFixtureTest.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/BenchmarkReaderScenario.kt' 'packages/android/app/src/main/java/com/selffeed/android/MainActivity.kt' 'packages/android/app/build.gradle.kts' 'packages/android/app/src/performanceTest/' 'packages/android/macrobenchmark/build.gradle.kts' 'packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/' 'packages/android/TESTING.md' 'scripts/android-review-device.sh' 'scripts/android-review-benchmark.sh' 'packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt' 'packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt' 'packages/android/app/src/test/java/com/selffeed/android/ui/BenchmarkReaderScenarioTest.kt' 'scripts/android-review-device-test.sh' 'scripts/android-review-process.sh'
```

Dependencies describe required contracts; unrelated hardware measurement can remain pending while completed deterministic fixtures support later work. Keep incomplete measurements visible and do not mark the final gate DONE. Expected changes from completed dependencies are normal. Compare their resulting contracts with the excerpts below and record the reconciled commit before editing. Investigate unrelated drift or a false premise; do not implement obsolete instructions or overwrite unrelated work.

## Why this matters

The review established source-level defects, not measured device results. Existing fast-swipe coverage chooses Text mode, the benchmark readiness marker follows article selection, and repository tests use a different offline-store binding from production. Establish a trustworthy, isolated way to verify subsequent work without installing over Gustavo's normal app.

## Current state and conventions

Production binds OfflineReadStore directly to LocalStore. Keep any legacy CompositeOfflineReadStore compatibility tests explicitly separate. The app already has a com.selffeed.android.devicetest variant, Hilt replacement repositories, Robolectric, and MainDispatcherRule. MainActivityHiltUiTest demonstrates ActivityScenario plus a fake repository. Architecture intent keeps numeric benchmarks manual until physical-device evidence supports thresholds.

`packages/android/app/src/main/java/com/selffeed/android/di/AppModule.kt:84`:

```kotlin
    @Provides
    @Singleton
    fun provideOfflineReadStore(
        localStore: LocalStore,
    ): OfflineReadStore = localStore
```

`packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt:93`:

```kotlin
        val moshi = com.selffeed.android.network.NetworkModule.provideMoshi()
        cacheStore = OfflineCacheStore(context, moshi)
        localStore = LocalStore(context, moshi)
        runBlocking {
            localStore.clearAll()
            cacheStore.clearAll()
        }
        offlineReadStore = CompositeOfflineReadStore(localStore, cacheStore)
        imageLoader = mockk(relaxed = true)
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

Use existing Kotlin types, sealed results, feature repositories, and test fixtures. Keep changes focused on the stated behavior. The examples above are drift anchors, not code to copy unchanged. Test patterns live in `packages/android/app/src/test/java/com/selffeed/android/ui/MainDispatcherRule.kt` for controlled coroutines and `packages/android/app/src/androidTest/java/com/selffeed/android/ui/MainActivityHiltUiTest.kt` for Hilt/ActivityScenario flows.

## Scope and safety

Allowed implementation paths, including explicitly proposed new files/directories:

- `packages/android/app/src/androidTest/java/com/selffeed/android/data/FakeSelfFeedRepository.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/di/TestRepositoryModule.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/AndroidReviewFixtureUiTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/ui/ArticleTabTestHarness.kt`
- `packages/android/app/src/androidTest/assets/android-review/`
- `packages/android/app/src/test/java/com/selffeed/android/data/RssRepositoryTest.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/data/ReviewRequestGate.kt`
- `packages/android/app/src/androidTest/java/com/selffeed/android/data/ReviewRequestGateTest.kt`
- `scripts/android-review-common.sh`
- `packages/android/app/src/main/java/com/selffeed/android/ui/BenchmarkReaderScenario.kt`
- `packages/android/app/src/main/java/com/selffeed/android/MainActivity.kt`
- `packages/android/app/build.gradle.kts`
- `packages/android/app/src/performanceTest/`
- `packages/android/macrobenchmark/build.gradle.kts`
- `packages/android/macrobenchmark/src/main/java/com/selffeed/android/macrobenchmark/`
- `packages/android/TESTING.md`
- `scripts/android-review-device.sh`
- `scripts/android-review-benchmark.sh`
- `packages/android/app/src/main/java/com/selffeed/android/ui/components/ArticleReaderPane.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/SelfFeedApp.kt`
- `packages/android/app/src/main/java/com/selffeed/android/ui/screens/ScreenContracts.kt`
- `packages/android/app/src/test/java/com/selffeed/android/ui/BenchmarkReaderScenarioTest.kt`
- `scripts/android-review-device-test.sh`
- `scripts/android-review-process.sh`
- `.github/workflows/android-ci.yml` for the required stacked-PR verification and isolated process test.
- `plans/android-review/progress.md` for execution tracking.
- This plan and its row in `plans/README.md`.

Keep API/web production behavior, live databases, deployment workflows, and the installed daily-driver app outside scope. Execute app work in an isolated checkout. Use synthetic fixtures and `com.selffeed.android.devicetest` for behavior tests. Set `ANDROID_REVIEW_SERIAL` to the explicitly identified test device; the wrapper from plan 033 must reject ambiguous targets. Performance installs must use its separately identified performance target. Never run a command that clears the normal app or shared device logs.

For nontrivial visible layout/copy changes, implement only the applicable choice recorded by plan 034 in `plans/android-review/design-selection.md`. Mechanical fixes may retain the existing UI. Keep black #000 backgrounds, white primary text, dense readable layouts, minimal copy, and finite motion. Persistent database changes require a new schema version, explicit forward migrations, exported schemas, and tests for clean creation and all supported upgrade paths, including the historical version-6 variant. Preserve user content, sessions, and queued changes.

Use branch `test/android-reader-fixtures` or an equivalent human, project-focused name in an isolated checkout. Keep commits scoped and use repository-style subjects such as `fix(android): preserve reader state`. Gustavo has authorized implementation, pushing feature branches, and opening separate real PRs for review. Use gh, incorporate latest main before opening each PR, and document stacked dependencies. Do not merge, deploy, or install over the daily-driver app.

## Verification commands

Commands below are execution gates, not claims that they ran during planning. Device/benchmark wrappers are new deliverables of plan 033 and must exist before they are used. Missing hardware leaves the relevant measurement pending; a mocked method call does not prove media or rendering behavior.

| Purpose | Command | Expected result |
| --- | --- | --- |
| unit | `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.BenchmarkReaderScenarioTest'` | All selected tests pass. |
| device | `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidReviewFixtureUiTest'` | On the designated isolated test target, every selected instrumentation test passes. |
| benchmark | `bash scripts/android-review-benchmark.sh --serial "$ANDROID_REVIEW_SERIAL" --output packages/android/build/review-performance` | Release-equivalent physical-device results and metadata are written; inspect the predeclared comparison and memory limits. |
| process | `bash scripts/android-review-process.sh 'com.selffeed.android.macrobenchmark.AndroidProcessHarnessTest'` | The separately hosted test runner survives target death; all selected recovery journeys pass with verified old/new target PIDs and persisted state. |
| build | `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest` | Lint and compilation succeed in the isolated checkout. |
| scope | `git diff --check && git status --short` | No whitespace errors; every changed path belongs to this plan's scope. |

## Implementation steps

### 1. Match the production dependency graph

Update production-path repository fixtures to use LocalStore as OfflineReadStore. Retain dedicated legacy-store tests where compatibility is intentional. Add controllable request gates and network state to the existing fake; avoid real credentials, publisher URLs, or copying a user database.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.BenchmarkReaderScenarioTest'`. All selected tests pass.

### 2. Add deterministic reader fixtures

Use local content for short text, long text, images, summary blocks, tables, malformed HTML, and playable local audio/video. Expose delayed detail, repeated sync revisions, failure, and acknowledgement ordering through the fake. Signal reader readiness from an actual body-render callback, not non-null selection. Keep all fixture routes inaccessible to normal debug/release users. Carry the readiness callback through the production reader and root call sites, and update BenchmarkReaderScenarioTest so selection alone is explicitly insufficient. Extend the existing assets source-set configuration without replacing schema fixtures: it currently overrides the default androidTest asset directory. Share the synthetic fixture files with the isolated performanceTest assets. Where the boundary under test is persistence/worker recovery, exercise production RssRepository and real Room with a controlled local transport, rather than replacing the repository with an in-memory fake.

Verify with `./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest --tests 'com.selffeed.android.data.RssRepositoryTest' --tests 'com.selffeed.android.ui.BenchmarkReaderScenarioTest'`. All selected tests pass.

### 3. Provide guarded device execution

Create scripts/android-review-device.sh accepting one fully qualified instrumentation test class or a comma-separated list of fully qualified classes. Require ANDROID_REVIEW_SERIAL, check adb devices -l, and refuse unless the intended target is the only connected device. Pass the serial explicitly to adb and Gradle. Run :app:connectedNonDisruptiveDeviceTest with android.testInstrumentationRunnerArguments.class. Verify the selected target APK application ID is com.selffeed.android.devicetest. Never install/clear/force-stop com.selffeed.android or clear shared logcat. The wrapper must fail before any mutation for absent, ambiguous, or mismatched targets. Verify both class-filter forms and all refusal branches with a fake adb/Gradle executable harness before invoking a real target; keep that script harness in scripts/android-review-device-test.sh. Run bash scripts/android-review-device-test.sh before the selected device test.

Verify with `bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidReviewFixtureUiTest'`. On the designated isolated test target, every selected instrumentation test passes.

### 4. Provide isolated release measurements

Add a separately identified, release-equivalent performanceTest target, profileable and minified, plus matching macrobenchmark configuration. Create android-review-benchmark.sh with the same serial guard, application-ID verification, and a refusal to target com.selffeed.android. Resolve the actual generated Gradle task with :macrobenchmark:tasks --all and hard-code that verified task in the wrapper, rather than assuming a plugin task name. Reuse the local fixture without real sessions. Document and record startup, rich body readiness, swipe frame timing, and open/close memory measurements, including device/WebView/build/animation settings. Do not add noisy numeric CI limits. Keep the component class com.selffeed.android.MainActivity independent from the suffixed application ID; StartupBenchmark currently constructs the class from the package. Resolve and record the generated target and test APK assembly tasks, run both, inspect both manifests, and execute a guarded local-fixture benchmark when the designated physical device is available. Task discovery alone is not a passing target validation. Record the fixture-only baseline commit before behavior changes. If hardware becomes available later, benchmark that preserved baseline and the candidate on the same device and configuration.

Verify with `bash scripts/android-review-benchmark.sh --serial "$ANDROID_REVIEW_SERIAL" --output packages/android/build/review-performance`. Release-equivalent physical-device results and metadata are written; inspect the predeclared comparison and memory limits.

### 5. Provide a test process that survives target death

Create scripts/android-review-process.sh accepting a fully qualified class or comma-separated class list and requiring ANDROID_REVIEW_SERIAL. Apply the same pre-mutation serial/package guards as the device wrapper. Run UiAutomator recovery tests from the existing macrobenchmark test APK, configured in a separate process from the isolated performanceTest application. Verify distinct test/target PIDs and the manifest/instrumentation target; do not launch these tests inside the app's AndroidJUnitRunner process. The fixture must use real Room/production repository plus a synthetic local transport and durable fixture state. Define phases: establish article/query/scroll and pending work, send the app task to background and wait for saved state, use an ordinary background-process kill, verify the target PID exited while the test runner survived, restore the existing task, verify a new target PID and persisted/restored state. Never use force-stop or task dismissal as proof of Android saved-state restoration. Add a basic harness test that validates these phases and permits deterministic transport suspension/rejection across the restart. Record the exact generated Gradle runner/assembly tasks in the wrapper and TESTING.md.

Verify with `bash scripts/android-review-process.sh 'com.selffeed.android.macrobenchmark.AndroidProcessHarnessTest'`. The separately hosted test runner survives target death; all selected recovery journeys pass with verified old/new target PIDs and persisted state.

## Test and acceptance contract

- [x] Repository behavior tests use the production offline-store binding.
- [x] Local rich-reader readiness is observed from the renderer; Text-only success cannot satisfy it.
- [x] All three execution wrappers reject a missing/ambiguous target before adb mutation and reject the daily-driver application ID.
- [x] TESTING.md contains exact runnable device and benchmark commands, fixture names, output locations, and baseline measurements or an explicit unmeasured status.
- [x] New fixture tests pass; subsequent behavioral defects are recorded, not silently redefined as expected behavior.
- [x] The isolated performance target and its test APK both assemble, use the intended package/component identities, and complete a guarded fixture benchmark on designated hardware, or the hardware-dependent evidence remains explicitly pending.
- [x] A guarded separate-process recovery fixture survives target process death, records distinct old/new target PIDs, and restores the backgrounded task without force-stop or normal-app access.
- [x] The targeted JVM tests, required device tests, and isolated lint/build commands above pass. Add new assertions to the named existing test classes or explicitly listed new classes, using real Room/WebView behavior where that is the affected boundary.
- [x] Record the failing command and symptom, passing command, tested commit, and artifact location. Performance claims include the device and configuration. Keep personal data and credentials out of artifacts.
- [x] `git diff --check` passes and scope review finds no unrelated changes.
- [ ] Update this status and the index row only after the criteria are satisfied. A missing design pick or required device evidence remains pending, not DONE.

## Specific stop conditions

- Do not use scripts/verify-android-release-startup.sh on a developer device: it installs and force-stops com.selffeed.android.
- If no safe physical performance target is available, finish the deterministic fixtures and record physical measurement as pending. Do not substitute emulator numbers for physical performance.
- If the current AGP/baseline plugin cannot isolate the performance target, resolve that build configuration before any physical benchmark install.
- If a necessary change falls outside the stated scope, describe the concrete dependency and amend the plan before expanding implementation. Continue independent authorized work.

## Maintenance

Keep fixture readiness coupled to production renderer readiness. Test hooks must be build-scoped. Feature owners add the regression that proves their own defect; this foundation should not grow into a second implementation of the app.

## Execution notes

- Reconciled against main `cd802e5` and roadmap `3fedeb1`. Existing `BenchmarkReaderScenarioTest` covers the proposed JVM fixture assertions; no duplicate `AndroidReviewFixtureTest` was added. Added a shared wrapper library and typed request gate to avoid copying test orchestration.
- Repository tests now use the exact production `LocalStore` binding. Legacy compatibility tests remain separate.
- The old readiness condition was selection-only. JVM assertions now require no ready marker after selection; a real Chromium callback makes the rich-reader instrumentation test pass.
- Guard refusal tests pass for missing, ambiguous and unauthorized targets, normal-app package mismatch, class filters, external runner and emulator performance rejection.
- Both isolated APK pairs build, including the minified performance target and self-instrumented runner. The actual generated task names and component identities are recorded in TESTING.md.
- The first recovery test failed to find its initial fixture. The fixture now uses system-bar insets, unique article IDs per run and an explicit new initial task; restoration uses the existing task. Real background process death now passes without force-stop, with real Room and saved UI state.
- Basic fixture readiness and recovery passed on the dedicated API 36.1 `small_phone` emulator at `emulator-5566`. All 420 JVM tests across 52 classes pass, lint passes, both isolated APK pairs assemble, both device fixture tests pass, and the external process test passes. It recorded target PID 8771 -> 8833 with runner PID 8755 surviving.
- Rich corpus assets and delayed/reordered request gates are available for later feature-specific tests. Durable worker/outbox and production navigation restoration are deliberately verified in their owning plans, not reimplemented in a fake app here.
- Physical release timing, native/WebView memory and repeated-cycle measurements remain pending. This plan does not claim performance or absence of leaks.

- Review found that startup benchmarks launched authentication and inherited a configurable real server. The performance target now always uses example.invalid; the benchmark opens and checks the synthetic reader queue. Review also found inconsistent state after successful gated mutations; the fake now applies successful responses and its test reads the resulting article state.
- Android CI previously filtered PRs to main/master, leaving stacked Android reviews without checks. Its Android-path filter now accepts any PR base, verifies wrapper guards, and runs the isolated real-process test on the disposable CI emulator. No deployment workflow changed.

- Local evidence: `/tmp/android-foundation-full.log`, `/tmp/android-foundation-device-final.log`, `/tmp/android-foundation-process-final.log`, `/tmp/android-foundation-gate-final.log` and `/tmp/android-foundation-benchmark-final.log`. Standard Gradle XML/HTML reports are in the paths documented in TESTING.md. Fixture-only baseline is the implementation commit in this PR; physical comparisons must retain that commit.
