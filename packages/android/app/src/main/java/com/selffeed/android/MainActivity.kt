package com.selffeed.android

import android.app.assist.AssistContent
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.metrics.performance.JankStats
import androidx.metrics.performance.PerformanceMetricsState
import com.selffeed.android.data.local.OfflineMediaCache
import com.selffeed.android.ui.AppViewModel
import com.selffeed.android.ui.BenchmarkScenario
import com.selffeed.android.ui.BenchmarkScenarioExtra
import com.selffeed.android.ui.AuthViewModel
import com.selffeed.android.ui.SelfFeedAppRoute
import com.selffeed.android.ui.benchmarkScenarioFor
import com.selffeed.android.ui.components.CustomTabsPrewarmer
import com.selffeed.android.ui.components.LocalCustomTabsPrewarmer
import com.selffeed.android.ui.components.LocalOfflineMediaCache
import com.selffeed.android.ui.parseSelfFeedAction
import com.selffeed.android.ui.parseSharedFeedAction
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject
    lateinit var offlineMediaCache: OfflineMediaCache
    private val appViewModel: AppViewModel by viewModels()
    private val authViewModel: AuthViewModel by viewModels()
    private var jankStats: JankStats? = null
    private lateinit var performanceMetricsState: PerformanceMetricsState.Holder
    private lateinit var customTabsPrewarmer: CustomTabsPrewarmer
    private var benchmarkScenario: BenchmarkScenario? = null
    @Volatile
    private var activeArticleUrl: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // Install the splash screen *before* `super.onCreate` so the
        // system uses the theme's `windowSplashScreenBackground` for
        // the first frame. The default splash is dismissed as soon as
        // the first composition is laid out — a typical "ready to
        // show UI" marker.
        val splash = installSplashScreen()
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        super.onCreate(savedInstanceState)
        benchmarkScenario = benchmarkScenarioFor(
            buildType = BuildConfig.BUILD_TYPE,
            requestedScenario = intent?.getStringExtra(BenchmarkScenarioExtra),
        )
        // Keep the splash on screen while the cold-start path runs.
        // This is the smallest "frozen frame" the user will ever see;
        // for a more controlled dismissal, hook into your VM's
        // `loading` state and call `splash.setKeepOnScreenCondition`.
        var ready = false
        splash.setKeepOnScreenCondition { !ready }
        // We dismiss once the very first frame is composed. Compose
        // drives its own readiness; tying this to a frame callback is
        // both simple and reliable.
        window.decorView.post {
            // Allow the next frame to render before dismissing so the
            // splash-to-content transition doesn't flash.
            window.decorView.post { ready = true }
        }
        performanceMetricsState = PerformanceMetricsState.getHolderForHierarchy(window.decorView)
        // The consumer only logs debug frames. Avoid collecting and dispatching
        // frame metrics in release builds when nothing consumes them.
        if (BuildConfig.DEBUG) {
            jankStats = JankStats.createAndTrack(window) { frameData ->
                if (frameData.isJank) {
                    Log.d(
                        TAG,
                        "Jank frame durationMs=${frameData.frameDurationUiNanos / NANOS_PER_MILLISECOND} states=${frameData.states}",
                    )
                }
            }
        }
        customTabsPrewarmer = CustomTabsPrewarmer(this)
        lifecycle.addObserver(customTabsPrewarmer)
        setContent {
            CompositionLocalProvider(
                LocalOfflineMediaCache provides offlineMediaCache,
                LocalCustomTabsPrewarmer provides customTabsPrewarmer,
            ) {
                SelfFeedAppRoute(
                    appViewModel = appViewModel,
                    authViewModel = authViewModel,
                    performanceMetricsState = performanceMetricsState,
                    benchmarkScenario = benchmarkScenario,
                    onActiveArticleUrlChanged = { activeArticleUrl = it },
                )
            }
        }
        acceptExternalIntent(intent)
    }

    override fun onProvideAssistContent(outContent: AssistContent) {
        super.onProvideAssistContent(outContent)
        val url = sanitizeAssistWebUrl(activeArticleUrl) ?: return
        outContent.webUri = url.toUri()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        acceptExternalIntent(intent)
    }

    private fun acceptExternalIntent(intent: Intent?) {
        val action = when {
            intent?.action == Intent.ACTION_VIEW ->
                intent.dataString?.let(::parseSelfFeedAction)
            intent?.action == Intent.ACTION_SEND && intent.type == "text/plain" ->
                parseSharedFeedAction(intent.getStringExtra(Intent.EXTRA_TEXT))
            else -> null
        }
        appViewModel.offerExternalAction(action)
    }

    override fun onResume() {
        super.onResume()
        jankStats?.isTrackingEnabled = true
    }

    override fun onPause() {
        jankStats?.isTrackingEnabled = false
        super.onPause()
    }

    internal companion object {
        const val TAG = "SelfFeedJank"
        const val NANOS_PER_MILLISECOND = 1_000_000L

        fun sanitizeAssistWebUrl(raw: String?): String? =
            raw?.trim()?.takeIf {
                it.startsWith("https://", ignoreCase = true) ||
                    it.startsWith("http://", ignoreCase = true)
            }
    }
}
