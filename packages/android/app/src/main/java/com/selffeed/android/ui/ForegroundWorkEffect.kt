package com.selffeed.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CoroutineScope

/** Cancels all structured reads at STOP and waits for them before the next visible interval. */
@Composable
internal fun ForegroundWorkEffect(ownerId: String, block: suspend CoroutineScope.() -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val currentBlock = rememberUpdatedState(block)
    LaunchedEffect(lifecycle, ownerId) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { currentBlock.value(this) }
    }
}
