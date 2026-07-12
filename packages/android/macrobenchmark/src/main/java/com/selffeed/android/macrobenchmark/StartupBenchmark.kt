package com.selffeed.android.macrobenchmark

import android.content.Intent
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val TARGET_PACKAGE = "com.selffeed.android"
private const val BenchmarkScenarioExtra = "com.selffeed.android.extra.BENCHMARK_SCENARIO"
private const val BenchmarkReaderScenarioName = "reader"
private const val BenchmarkArticleCardDescription = "Unread article: Reader navigation performance, from Self Feed"
private const val BenchmarkReaderReadyDescription = "Benchmark reader ready"
private const val UiTimeoutMillis = 5_000L

/**
 * Cold-startup benchmark for manual release-performance investigation. The
 * BaselineProfileGenerator (below)
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
 * The Baseline Profile Gradle plugin copies the generated profile into the
 * target app's release source set; do not copy artifacts by hand.
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule
    val baselineProfileRule = BaselineProfileRule()

    @Test
    fun generateBaselineProfile() = baselineProfileRule.collect(
        packageName = TARGET_PACKAGE,
        includeInStartupProfile = true,
    ) {
        // This explicit, benchmark-only intent is recognized only by the
        // plugin-generated benchmark/non-minified target variants. It avoids
        // credentials, live feeds, and a flaky "first clickable" selector
        // while exercising the production ArticleCard and ArticleReaderPane.
        startActivityAndWait(benchmarkReaderIntent())
        check(device.wait(Until.hasObject(By.desc(BenchmarkArticleCardDescription)), UiTimeoutMillis)) {
            "Benchmark article card was not rendered"
        }
        device.findObject(By.desc(BenchmarkArticleCardDescription)).click()
        check(device.wait(Until.hasObject(By.desc(BenchmarkReaderReadyDescription)), UiTimeoutMillis)) {
            "Benchmark reader did not become ready"
        }
        device.waitForIdle()
    }
}

private fun benchmarkReaderIntent(): Intent = Intent(Intent.ACTION_MAIN).apply {
    addCategory(Intent.CATEGORY_LAUNCHER)
    setPackage(TARGET_PACKAGE)
    putExtra(BenchmarkScenarioExtra, BenchmarkReaderScenarioName)
}
