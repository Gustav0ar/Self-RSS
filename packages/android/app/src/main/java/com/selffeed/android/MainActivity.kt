package com.selffeed.android

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.metrics.performance.JankStats
import androidx.metrics.performance.PerformanceMetricsState
import com.selffeed.android.ui.MainViewModel
import com.selffeed.android.ui.MainViewModelFactory
import com.selffeed.android.ui.SelfFeedApp
import com.selffeed.android.ui.theme.SelfFeedTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels {
        MainViewModelFactory((application as SelfFeedApplication).repository)
    }
    private var jankStats: JankStats? = null
    private lateinit var performanceMetricsState: PerformanceMetricsState.Holder

    override fun onCreate(savedInstanceState: Bundle?) {
        // Install the splash screen *before* `super.onCreate` so the
        // system uses the theme's `windowSplashScreenBackground` for
        // the first frame. The default splash is dismissed as soon as
        // the first composition is laid out — a typical "ready to
        // show UI" marker.
        val splash = installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Keep the splash on screen while the cold-start path runs.
        // This is the smallest "frozen frame" the user will ever see;
        // for a more controlled dismissal, hook into your VM's
        // `loading` state and call `splash.setKeepOnScreenCondition`.
        var ready = false
        splash.setKeepOnScreenCondition { ready }
        // We dismiss once the very first frame is composed. Compose
        // drives its own readiness; tying this to a frame callback is
        // both simple and reliable.
        window.decorView.post {
            // Allow the next frame to render before dismissing so the
            // splash-to-content transition doesn't flash.
            window.decorView.post { ready = true }
        }
        performanceMetricsState = PerformanceMetricsState.getHolderForHierarchy(window.decorView)
        jankStats = JankStats.createAndTrack(window) { frameData ->
            if (BuildConfig.DEBUG && frameData.isJank) {
                Log.d(
                    TAG,
                    "Jank frame durationMs=${frameData.frameDurationUiNanos / NANOS_PER_MILLISECOND} states=${frameData.states}",
                )
            }
        }
        setContent {
            val themePreference by viewModel.themePreference.collectAsStateWithLifecycle()
            val darkTheme = when (themePreference) {
                "light" -> false
                "dark" -> true
                else -> isSystemInDarkTheme()
            }
            SelfFeedTheme(darkTheme = darkTheme) {
                val state by viewModel.uiState.collectAsStateWithLifecycle()
                LaunchedEffect(state.activeTab, state.selectedArticle?.id) {
                    performanceMetricsState.state?.putState("tab", state.activeTab.name)
                    performanceMetricsState.state?.putState(
                        "reader",
                        if (state.selectedArticle == null) "closed" else "open",
                    )
                }
                SelfFeedApp(state = state, viewModel = viewModel)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        jankStats?.isTrackingEnabled = true
    }

    override fun onPause() {
        jankStats?.isTrackingEnabled = false
        super.onPause()
    }

    private companion object {
        const val TAG = "SelfFeedJank"
        const val NANOS_PER_MILLISECOND = 1_000_000L
    }
}
