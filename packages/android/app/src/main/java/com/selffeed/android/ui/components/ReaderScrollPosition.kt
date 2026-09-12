package com.selffeed.android.ui.components

import androidx.compose.foundation.ScrollState
import androidx.compose.runtime.saveable.Saver

/** Keeps restored intent until the asynchronously prepared body has been laid out. */
internal class ReaderScrollPosition(private var restoredOffset: Int? = null) {
    val scrollState = ScrollState(0)

    suspend fun restoreAfterBodyLayout() {
        val offset = restoredOffset ?: return
        // A gesture already in progress takes precedence over restoration.
        if (!scrollState.isScrollInProgress) scrollState.scrollTo(offset)
        restoredOffset = null
    }

    companion object {
        val Saver = Saver<ReaderScrollPosition, Int>(
            save = { it.restoredOffset ?: it.scrollState.value },
            restore = { ReaderScrollPosition(it) },
        )
    }
}
