package com.selffeed.android

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.metrics.performance.JankStats
import androidx.metrics.performance.PerformanceMetricsState
import com.selffeed.android.ui.AppViewModel
import com.selffeed.android.ui.ArticlesViewModel
import com.selffeed.android.ui.AuthViewModel
import com.selffeed.android.ui.FeedsViewModel
import com.selffeed.android.ui.SearchViewModel
import com.selffeed.android.ui.SelfFeedAppRoute
import com.selffeed.android.ui.SettingsViewModel
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val appViewModel: AppViewModel by viewModels()
    private val authViewModel: AuthViewModel by viewModels()
    private val feedsViewModel: FeedsViewModel by viewModels()
    private val articlesViewModel: ArticlesViewModel by viewModels()
    private val searchViewModel: SearchViewModel by viewModels()
    private val settingsViewModel: SettingsViewModel by viewModels()
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
            SelfFeedAppRoute(
                appViewModel = appViewModel,
                authViewModel = authViewModel,
                feedsViewModel = feedsViewModel,
                articlesViewModel = articlesViewModel,
                searchViewModel = searchViewModel,
                settingsViewModel = settingsViewModel,
                performanceMetricsState = performanceMetricsState,
            )
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
