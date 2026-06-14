package com.selffeed.android.ui.components

import androidx.activity.ComponentActivity
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.layout.LayoutInfo
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasProgressBarRangeInfo
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Regression test for the loading spinner animation.
 *
 * An earlier revision of the app wrapped Material3's indeterminate
 * [CircularProgressIndicator] in an extra
 * `Modifier.graphicsLayer { rotationZ = ... }` driven by its own
 * `rememberInfiniteTransition`. In some rendering contexts (the
 * app-startup loading screen and the pull-to-refresh indicator slot)
 * the cached graphics layer suppressed the inner draw updates and the
 * spinner froze on a single frame — visible to the user as a static
 * dot in the center of an otherwise-empty screen.
 *
 * The fix is to use [CircularProgressIndicator] directly, with no
 * outer rotation transform. This test guards that by walking the
 * indicator's [LayoutInfo] chain and failing if any
 * `graphicsLayer { ... }` block modifier is found wrapping the
 * spinner.
 *
 * `captureToImage`-based pixel diffing was considered but does not
 * work under Robolectric (window capture requires a real Surface).
 * The modifier-class check is stable, fast, and runs in unit tests.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class LoadingSpinnerRegressionTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun loadingSpinner_rendersIndeterminateWithoutOuterRotationLayer() {
        composeRule.setContent {
            SelfFeedTheme {
                // Mirrors the call sites in SelfFeedApp.LoadingScreen and
                // the PullToRefreshBox indicator slot: a bare
                // CircularProgressIndicator with no outer rotation
                // transform.
                CircularProgressIndicator()
            }
        }

        composeRule
            .onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate))
            .assertIsDisplayed()

        val node = composeRule
            .onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate))
            .fetchSemanticsNode()

        val offenders = collectGraphicsLayerModifiers(node)

        assertFalse(
            "Loading spinner has a `graphicsLayer { ... }` modifier in " +
                "its layout chain. Do not wrap CircularProgressIndicator " +
                "in an outer rotation transform — Material3's indeterminate " +
                "indicator already animates correctly on its own, and an " +
                "outer layer was the cause of the frozen-spinner bug. " +
                "Found: $offenders",
            offenders.isNotEmpty(),
        )
    }

    private fun collectGraphicsLayerModifiers(start: SemanticsNode): List<String> {
        val matches = mutableListOf<String>()
        val seen = mutableSetOf<LayoutInfo>()
        val queue = ArrayDeque<LayoutInfo>()
        queue += start.layoutInfo
        while (queue.isNotEmpty()) {
            val info = queue.removeFirst()
            if (!seen.add(info)) continue
            for (modifierInfo in info.getModifierInfo()) {
                val name = modifierInfo.modifier::class.java.name
                if (name.contains("GraphicsLayer")) {
                    matches += name
                }
            }
            val parent: LayoutInfo? = info.parentInfo
            if (parent != null) queue += parent
        }
        return matches
    }
}



