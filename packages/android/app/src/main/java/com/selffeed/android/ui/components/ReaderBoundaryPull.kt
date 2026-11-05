package com.selffeed.android.ui.components

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.pager.PagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sign

@Composable
internal fun rememberReaderBoundaryPull(
    pager: PagerState,
    atFeedStart: Boolean,
    atFeedEnd: Boolean,
): ReaderBoundaryPull {
    val scope = rememberCoroutineScope()
    val limit = with(LocalDensity.current) { 22.dp.toPx() }
    val direction = if (LocalLayoutDirection.current == LayoutDirection.Ltr) 1f else -1f
    val start by rememberUpdatedState(atFeedStart)
    val end by rememberUpdatedState(atFeedEnd)
    return remember(pager, scope, limit, direction) {
        ReaderBoundaryPull(scope, limit) { delta ->
            // A loaded page boundary is not necessarily the end of the feed.
            if (delta * direction > 0f) start && !pager.canScrollBackward
            else end && !pager.canScrollForward
        }
    }
}

/** Handles only unconsumed horizontal finger motion. Normal paging and vertical reading pass through. */
internal class ReaderBoundaryPull(
    private val scope: CoroutineScope,
    private val limit: Float,
    private val isBoundary: (Float) -> Boolean,
) : NestedScrollConnection {
    private var pull by mutableFloatStateOf(0f)
    private var settling: Job? = null

    val translation: Float
        get() = if (isBoundary(pull)) {
            sign(pull) * limit * (1f - exp(-abs(pull) / (limit * 3f)))
        } else 0f

    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
        if (source != NestedScrollSource.UserInput || available.x == 0f) return Offset.Zero
        settling?.cancel()
        settling = null
        if (!isBoundary(pull)) pull = 0f
        // Unwind the existing pull before allowing an inward drag to turn the page.
        if (pull * available.x < 0f) {
            val consumed = sign(available.x) * minOf(abs(available.x), abs(pull))
            pull += consumed
            return Offset(consumed, 0f)
        }
        return Offset.Zero
    }

    override fun onPostScroll(
        consumed: Offset,
        available: Offset,
        source: NestedScrollSource,
    ): Offset {
        if (source != NestedScrollSource.UserInput || available.x == 0f || !isBoundary(available.x)) {
            return Offset.Zero
        }
        // Bound the stored drag as well as its visual displacement, so reversal stays responsive.
        pull = (pull + available.x).coerceIn(-limit * 9f, limit * 9f)
        return Offset(available.x, 0f)
    }

    override suspend fun onPreFling(available: Velocity): Velocity {
        if (pull == 0f) return Velocity.Zero
        release()
        return Velocity(available.x, 0f)
    }

    override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
        release()
        return Velocity.Zero
    }

    private fun release() {
        if (pull == 0f || settling?.isActive == true) return
        settling = scope.launch {
            // No oscillation, layout changes, or work after the spring has settled.
            animate(pull, 0f, animationSpec = spring(dampingRatio = 1f, stiffness = 500f)) { value, _ ->
                pull = value
            }
            pull = 0f
        }
    }
}
