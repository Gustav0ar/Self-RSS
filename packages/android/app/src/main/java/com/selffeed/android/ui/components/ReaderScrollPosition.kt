package com.selffeed.android.ui.components

import androidx.compose.foundation.ScrollState
import androidx.compose.runtime.saveable.Saver

/** Keeps reading intent while a replacement body is prepared and laid out. */
internal class ReaderScrollPosition(private var pendingOffset: Int? = null) {
    val scrollState = ScrollState(0)

    fun retainForBodyReplacement() {
        // Repeated replacements must not save an already-clamped placeholder offset.
        if (pendingOffset == null && !scrollState.isScrollInProgress) {
            pendingOffset = scrollState.value
        }
    }

    fun onUserScroll() {
        pendingOffset = null
    }

    suspend fun restoreAfterBodyLayout() {
        val offset = pendingOffset ?: return
        // A gesture already in progress takes precedence over restoration.
        if (!scrollState.isScrollInProgress) scrollState.scrollTo(offset)
        pendingOffset = null
    }

    companion object {
        val Saver = Saver<ReaderScrollPosition, Int>(
            save = { it.pendingOffset ?: it.scrollState.value },
            restore = { ReaderScrollPosition(it) },
        )
    }
}
