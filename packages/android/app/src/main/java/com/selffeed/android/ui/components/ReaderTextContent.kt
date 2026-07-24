package com.selffeed.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.selffeed.android.R
import androidx.core.text.HtmlCompat
import com.selffeed.android.ui.ReaderAppearance

/** A distraction-free, media-free representation of an article. */
internal sealed interface ReaderTextBlock {
    val text: String

    data class Heading(override val text: String) : ReaderTextBlock

    data class Paragraph(override val text: String) : ReaderTextBlock

    data class Bullet(override val text: String) : ReaderTextBlock
}

/**
 * Builds readable article blocks for Text mode.
 *
 * HTML is used only as structural input: media containers are removed before
 * extracting text, while headings, paragraphs, and list items remain useful
 * reading landmarks. If HTML is unavailable, the API's plain-text snapshot is
 * used instead.
 */
internal fun readerTextBlocks(
    html: String?,
    text: String?,
    fallback: String? = null,
): List<ReaderTextBlock> {
    val source = html
        ?.takeIf(String::isNotBlank)
        ?.let(::readerTextFromHtml)
        ?: text?.takeIf(String::isNotBlank)
        ?: fallback.orEmpty()
    return parseReaderTextBlocks(source)
}

@Composable
internal fun ReaderTextContent(
    html: String?,
    text: String?,
    fallback: String?,
    appearance: ReaderAppearance = ReaderAppearance(),
    modifier: Modifier = Modifier,
) {
    val blocks = remember(html, text, fallback) { readerTextBlocks(html, text, fallback) }
    val paragraphStyle = MaterialTheme.typography.bodyLarge.copy(
        fontFamily = appearance.font.composeFontFamily,
        fontSize = appearance.boundedTextSizeSp.sp,
        lineHeight = (appearance.boundedTextSizeSp * 1.72f).sp,
        letterSpacing = 0.1.sp,
    )
    val headingStyle = MaterialTheme.typography.titleLarge.copy(
        fontFamily = appearance.font.composeFontFamily,
        fontSize = (appearance.boundedTextSizeSp * 1.18f).coerceIn(18f, 30f).sp,
        lineHeight = (appearance.boundedTextSizeSp * 1.34f).coerceIn(24f, 40f).sp,
        fontWeight = FontWeight.SemiBold,
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag("reader-text-content"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (blocks.isEmpty()) {
            Text(
                text = stringResource(R.string.reader_no_text_content),
                style = paragraphStyle,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        blocks.forEach { block ->
            when (block) {
                is ReaderTextBlock.Heading -> Text(
                    text = block.text,
                    style = headingStyle,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                is ReaderTextBlock.Paragraph -> Text(
                    text = block.text,
                    style = paragraphStyle,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                is ReaderTextBlock.Bullet -> Row(
                    verticalAlignment = Alignment.Top,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = "•",
                        style = paragraphStyle,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = block.text,
                        style = paragraphStyle,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

private fun readerTextFromHtml(html: String): String {
    val mediaFreeHtml = html
        .replace(READER_MEDIA_CONTAINER_REGEX, READER_PARAGRAPH_BREAK_HTML)
        .replace(READER_MEDIA_TAG_REGEX, READER_PARAGRAPH_BREAK_HTML)
        .replace(READER_NON_TEXT_CONTAINER_REGEX, READER_PARAGRAPH_BREAK_HTML)

    val structuredHtml = mediaFreeHtml
        .replace(READER_HEADING_OPEN_TAG_REGEX, "$READER_PARAGRAPH_BREAK_HTML$READER_HEADING_MARKER")
        .replace(READER_HEADING_CLOSE_TAG_REGEX, READER_PARAGRAPH_BREAK_HTML)
        .replace(READER_LIST_ITEM_OPEN_TAG_REGEX, "$READER_LINE_BREAK_HTML$READER_BULLET_MARKER")
        .replace(READER_LIST_ITEM_CLOSE_TAG_REGEX, READER_LINE_BREAK_HTML)
        .replace(READER_LINE_BREAK_TAG_REGEX, READER_LINE_BREAK_HTML)
        .replace(READER_BLOCK_TAG_REGEX, READER_PARAGRAPH_BREAK_HTML)

    return HtmlCompat.fromHtml(structuredHtml, HtmlCompat.FROM_HTML_MODE_LEGACY)
        .toString()
        .replace('\uFFFC'.toString(), "")
}

private fun parseReaderTextBlocks(source: String): List<ReaderTextBlock> {
    val blocks = mutableListOf<ReaderTextBlock>()
    val paragraphLines = mutableListOf<String>()

    fun flushParagraph() {
        val paragraph = paragraphLines.joinToString(" ").normalizeReaderText()
        paragraphLines.clear()
        if (paragraph.isBlank()) return
        splitLongReaderParagraph(paragraph).forEach { blocks += ReaderTextBlock.Paragraph(it) }
    }

    source.lineSequence().forEach { rawLine ->
        val line = rawLine.trim()
        when {
            line.isBlank() -> flushParagraph()
            line.startsWith(READER_HEADING_MARKER) -> {
                flushParagraph()
                line.removePrefix(READER_HEADING_MARKER)
                    .normalizeReaderText()
                    .takeIf(String::isNotBlank)
                    ?.let { blocks += ReaderTextBlock.Heading(it) }
            }

            line.startsWith(READER_BULLET_MARKER) -> {
                flushParagraph()
                line.removePrefix(READER_BULLET_MARKER)
                    .normalizeReaderText()
                    .takeIf(String::isNotBlank)
                    ?.let { blocks += ReaderTextBlock.Bullet(it) }
            }

            else -> paragraphLines += line
        }
    }
    flushParagraph()

    return blocks
}

private fun String.normalizeReaderText(): String =
    replace(Regex("\\s+"), " ").trim()

private fun splitLongReaderParagraph(paragraph: String): List<String> {
    if (paragraph.length <= READER_IDEAL_PARAGRAPH_LENGTH) return listOf(paragraph)

    val chunks = mutableListOf<String>()
    val current = StringBuilder()
    paragraph.split(' ').filter(String::isNotBlank).forEach { word ->
        if (current.isNotEmpty()) current.append(' ')
        current.append(word)

        val canBreakAtSentence = current.length >= READER_MIN_PARAGRAPH_LENGTH &&
            word.lastOrNull() in READER_SENTENCE_ENDINGS
        if (canBreakAtSentence || current.length >= READER_MAX_PARAGRAPH_LENGTH) {
            chunks += current.toString()
            current.clear()
        }
    }
    if (current.isNotEmpty()) chunks += current.toString()

    return chunks
}

private const val READER_HEADING_MARKER = "\uE000heading\uE001"
private const val READER_BULLET_MARKER = "\uE000bullet\uE001"
private const val READER_LINE_BREAK_HTML = "<br />"
private const val READER_PARAGRAPH_BREAK_HTML = "<br /><br />"
private const val READER_MIN_PARAGRAPH_LENGTH = 280
private const val READER_IDEAL_PARAGRAPH_LENGTH = 520
private const val READER_MAX_PARAGRAPH_LENGTH = 640
private val READER_SENTENCE_ENDINGS = setOf('.', '!', '?', '…')

private val READER_MEDIA_CONTAINER_REGEX = Regex(
    """<\s*(figure|picture|video|audio|iframe|object|embed|svg|canvas)\b[^>]*>.*?<\s*/\s*\1\s*>""",
    setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
)

private val READER_MEDIA_TAG_REGEX = Regex(
    """<\s*/?\s*(?:img|source|track|video|audio|iframe|object|embed|picture|figure|svg|canvas)\b[^>]*>""",
    RegexOption.IGNORE_CASE,
)

private val READER_NON_TEXT_CONTAINER_REGEX = Regex(
    """<\s*(?:script|style|template|noscript)\b[^>]*>.*?<\s*/\s*(?:script|style|template|noscript)\s*>""",
    setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
)

private val READER_HEADING_OPEN_TAG_REGEX = Regex(
    """<\s*h[1-6]\b[^>]*>""",
    RegexOption.IGNORE_CASE,
)

private val READER_HEADING_CLOSE_TAG_REGEX = Regex(
    """<\s*/\s*h[1-6]\s*>""",
    RegexOption.IGNORE_CASE,
)

private val READER_LIST_ITEM_OPEN_TAG_REGEX = Regex(
    """<\s*li\b[^>]*>""",
    RegexOption.IGNORE_CASE,
)

private val READER_LIST_ITEM_CLOSE_TAG_REGEX = Regex(
    """<\s*/\s*li\s*>""",
    RegexOption.IGNORE_CASE,
)

private val READER_LINE_BREAK_TAG_REGEX = Regex(
    """<\s*br\s*/?\s*>""",
    RegexOption.IGNORE_CASE,
)

private val READER_BLOCK_TAG_REGEX = Regex(
    """<\s*/?\s*(?:address|article|aside|blockquote|caption|dd|div|dl|dt|footer|header|hr|main|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>""",
    RegexOption.IGNORE_CASE,
)
