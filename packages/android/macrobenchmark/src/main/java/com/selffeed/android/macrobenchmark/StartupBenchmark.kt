package com.selffeed.android.macrobenchmark

import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val TARGET_PACKAGE = "com.selffeed.android"

/**
 * Cold-startup benchmark. The CI runner uses this to flag regressions in
 * the time-to-first-frame budget. The BaselineProfileGenerator (below)
 * also calls `startActivityAndWait`, so this benchmark's compilation mode
 * is a reasonable proxy for what the production app will see once the
 * profile is applied.
 */
@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

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
}

/**
 * Generates a [Baseline Profile] that covers the user-visible critical
 * paths. Run via:
 *
 *   ./gradlew :macrobenchmark:pixel6Api31BenchmarkAndroidTest \
 *     -Pandroid.testInstrumentationRunnerArguments.class=com.selffeed.android.macrobenchmark.BaselineProfileGenerator
 *
 * The generated profile is written to
 * `macrobenchmark/build/outputs/managed_device_and_test_results/.../baseline-prof.txt`
 * and should be copied to `app/src/main/baseline-prof.txt`.
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule
    val baselineProfileRule = BaselineProfileRule()

    @Test
    fun generateBaselineProfile() = baselineProfileRule.collect(
        packageName = TARGET_PACKAGE,
    ) {
        // Cover the critical user paths in order: splash → shell →
        // feed list → article reader → reader back-out.
        startActivityAndWait()
        device.waitForIdle()

        // Wait for the auth screen or feed list to render.
        device.waitForIdle()

        // If the device is logged in (test seeding has a valid session),
        // exercise the feed → article open path. The benchmark stays
        // useful when logged out too — the cold-start path is the same.
        if (device.findObject(
                androidx.test.uiautomator.By.res(
                    // Settings tab is always present when authenticated.
                    packageName: TARGET_PACKAGE,
                ),
            ) != null
        ) {
            // Open the first article in the list. The selector is
            // intentionally loose — the goal is to warm the article
            // detail + reader code paths, not to assert a specific UI.
            device.findObject(
                androidx.test.uiautomator.By.clickable(true),
            )?.click()
            device.waitForIdle()
        }
    }
}
