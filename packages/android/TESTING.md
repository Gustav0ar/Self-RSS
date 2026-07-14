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

# Repository Android verification
bun run android:check
```

Confirm the intended target with `adb devices -l` before running connected tests when multiple devices are available.
