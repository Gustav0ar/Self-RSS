package com.selffeed.android.ui.components

import com.selffeed.android.ui.ReaderAppearance
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

internal data class ReaderHtmlInput(
    val html: String,
    val colors: ReaderHtmlColors,
    val appearance: ReaderAppearance,
    val textScale: Float,
    val baseUrl: String,
    val backgroundColor: Int,
)

internal data class PreparedReaderHtml(val input: ReaderHtmlInput, val document: String)

/** Prepares immutable render input without retaining an Activity or renderer. */
internal class ReaderContentPreparer(
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
) {
    suspend fun html(input: ReaderHtmlInput): PreparedReaderHtml = withContext(dispatcher) {
        currentCoroutineContext().ensureActive()
        val document = buildReaderHtmlDocument(input.html, input.colors, input.appearance, input.textScale)
        currentCoroutineContext().ensureActive()
        PreparedReaderHtml(input, document)
    }

    suspend fun text(html: String?, text: String?, fallback: String?): List<ReaderTextBlock> = withContext(dispatcher) {
        currentCoroutineContext().ensureActive()
        val blocks = readerTextBlocks(html, text, fallback)
        currentCoroutineContext().ensureActive()
        blocks
    }
}

internal val LocalReaderContentPreparer = staticCompositionLocalOf { ReaderContentPreparer() }
