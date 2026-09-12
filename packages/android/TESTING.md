# Android testing

The Android client uses JUnit 4, kotlinx-coroutines-test, MockK, Robolectric Compose tests, and Compose instrumentation tests. Instrumentation targets the isolated `deviceTest` application ID so it does not replace or clear the normal installed app.

## Test layers

- Pure unit tests cover repositories, ViewModels, state reducers, prefetching, and read-state behavior.
- Robolectric Compose tests cover component rendering and interaction regressions without requiring a device.
- Instrumented Compose tests cover complete user journeys on an emulator or physical device.

Reader swipe regressions are covered by:

- `ArticleWarmingManagerTest`: warming window, deduplication, cancellation safety, and embedded-image prefetch.
- `ArticlesViewModelTest`: warmed details are retained and selected synchronously.
- `ArticleReaderPaneNavigationTest`: rapid swipes never render an article loading placeholder, only the active page reports display, and the visible feed source tracks forward/backward gestures immediately.
- `ArticleListDetailNavigationTest`: changing the selected article never disposes or recreates the reader navigation entry.
- `ArticleListDetailNavigationTest`: article-list taps start the reader transition in the click event instead of waiting for a state-observer frame.
- `ArticleReaderFastSwipeE2eTest`: repeated forward and backward swipes on a real Android runtime keep prefetched content visible.

## Commands

```bash
# All Android JVM/Robolectric tests
./packages/android/gradlew -p packages/android :app:testDeviceTestUnitTest

# Lint and build the debug app
./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDebug

# Compile instrumentation tests
./packages/android/gradlew -p packages/android :app:assembleDeviceTestAndroidTest

# Run instrumentation tests without disturbing the normal app installation
./packages/android/gradlew -p packages/android :app:connectedNonDisruptiveDeviceTest

# Repository Android verification (including instrumentation-test compilation)
bun run android:check
```

Confirm the intended target with `adb devices -l` before running connected tests when multiple devices are available.

## Android experience review (plans 033–049)

Use a dedicated target and an isolated checkout. The guarded wrappers refuse a missing, additional offline/unauthorized, or ambiguous device before installation, verify both APK application IDs, and pass the selected serial to adb and Gradle. They never target `com.selffeed.android`.

```bash
export ANDROID_REVIEW_SERIAL=emulator-5566 # replace with the designated review device
bash scripts/android-review-device-test.sh
bash scripts/android-review-device.sh 'com.selffeed.android.ui.AndroidReviewFixtureUiTest,com.selffeed.android.data.ReviewRequestGateTest'
bash scripts/android-review-process.sh 'com.selffeed.android.macrobenchmark.AndroidProcessHarnessTest'
# Physical hardware only; emulator behavior is not performance evidence.
bash scripts/android-review-benchmark.sh --serial "$ANDROID_REVIEW_SERIAL" --output /tmp/android-review-performance
```

Set `JAVA_HOME`, `ANDROID_HOME` and optionally `GRADLE_USER_HOME` for the isolated environment. Set `SELF_FEED_API_BASE_URL=https://example.invalid/api/v1/` for synthetic review builds. Do not run the repository's normal release startup installer on a developer device.

The exact generated tasks are `:app:assembleDeviceTest`, `:app:assembleDeviceTestAndroidTest`, `:app:connectedNonDisruptiveDeviceTest`, `:app:assembleBenchmarkPerformanceTest`, `:macrobenchmark:assembleBenchmarkPerformanceTest` and `:macrobenchmark:connectedBenchmarkPerformanceTestAndroidTest`. The release-equivalent target is minified/resource-shrunk, profileable, debug-signed and identified as `com.selffeed.android.performancetest`. Its real component remains `com.selffeed.android.MainActivity`. The self-instrumented runner is `com.selffeed.android.macrobenchmark`; killing the target cannot kill the runner.

`AndroidReviewFixtureUiTest` observes Chromium's visual-state callback through the production reader. Selecting an article alone cannot mark it ready. `ReviewRequestGate` lets feature tests suspend details or mutations and return responses independently in any order; the fake also exposes connectivity and suspendable repeated realtime events. Production repository tests bind `OfflineReadStore` directly to Room-backed `LocalStore`; only dedicated legacy compatibility tests use the composite store.

The synthetic corpus at `app/src/androidTest/assets/android-review` contains short text, a 200-section article, summary, wide table, malformed HTML, SVG, WAV audio and MP4 video. Both instrumentation and performance-test variants package it; normal app variants do not. Feature tests must exercise these through the production renderer/resolver, not a parallel reader.

The basic recovery fixture writes a unique body through real Room, opens it through the production repository, records a `rememberSaveable` user action, backgrounds the task, kills only its ordinary background process, verifies PID exit, and restores the same task in a new process. Revalidation can reach only a closed loopback port. The test records old/new target PIDs and the surviving runner PID under `AndroidReview` in its log. It is a harness check, not evidence that production Search/list anchors, downloads or outbox recovery work. Those journeys belong to plans 035, 042 and 043.

JVM reports are under `app/build/test-results/testDeviceTestUnitTest`. Device reports are under `app/build/outputs/androidTest-results/connected/deviceTest`; external-runner reports are under `macrobenchmark/build/outputs/androidTest-results/connected/benchmarkPerformanceTest`. The benchmark wrapper copies output plus device/API/WebView metadata to its requested directory. Keep each comparison in a new directory and preserve its source commit.

Current baseline: dedicated `small_phone` emulator, Android 16 / API 36.1, 720×1280, density 320, SwiftShader. Rich readiness and basic real process/Room recovery passed. Physical startup/frame timing, renderer PSS/native heap, repeated open/close retention and battery measurements are **unmeasured**. Preserve the plan-033 PR commit as the fixture baseline and compare it with the candidate on the same identified physical device and configuration. Do not derive numeric performance gates from emulator timings.
