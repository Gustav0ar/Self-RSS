package com.selffeed.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.fromHtml
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.text.HtmlCompat
import com.selffeed.android.R
import com.selffeed.android.ui.ReaderAppearance
import kotlinx.coroutines.flow.first
import java.net.URI

/** A distraction-free, media-free representation of an article. */
internal sealed interface ReaderTextBlock {
    val text: String
    val inlineHtml: String?

    data class Heading(
        override val text: String,
        override val inlineHtml: String? = null,
    ) : ReaderTextBlock

    data class Paragraph(
        override val text: String,
        override val inlineHtml: String? = null,
    ) : ReaderTextBlock

    data class Bullet(
        override val text: String,
        override val inlineHtml: String? = null,
    ) : ReaderTextBlock
}

/**
 * Builds readable article blocks for Text mode.
 *
 * HTML is used as structural and inline-formatting input: media containers are
 * removed, while headings, paragraphs, list items, emphasis, inline code, and
 * safe http/https links remain usable. If HTML is unavailable, the API's
 * plain-text snapshot is used instead.
 */
internal fun readerTextBlocks(
    html: String?,
    text: String?,
    fallback: String? = null,
    baseUrl: String? = null,
): List<ReaderTextBlock> {
    val htmlSource = html?.takeIf(String::isNotBlank)
    if (htmlSource != null) {
        return parseReaderHtmlBlocks(htmlSource, baseUrl)
    }
    val plainSource = text?.takeIf(String::isNotBlank) ?: fallback.orEmpty()
    return parsePlainTextBlocks(plainSource)
}

@Composable
internal fun ReaderTextContent(
    documentId: String,
    html: String?,
    text: String?,
    fallback: String?,
    modifier: Modifier = Modifier,
    appearance: ReaderAppearance = ReaderAppearance(),
    documentBaseUrl: String? = null,
    preparer: ReaderContentPreparer = LocalReaderContentPreparer.current,
    onReady: () -> Unit = {},
) {
    val prepared by key(documentId) {
        produceState<List<ReaderTextBlock>?>(null, html, text, fallback, documentBaseUrl, preparer) {
            value = preparer.text(html, text, fallback, documentBaseUrl)
        }
    }
    val blocks = prepared
    var readyReported by remember(documentId, blocks) { mutableStateOf(false) }
    val latestOnReady by rememberUpdatedState(onReady)
    LaunchedEffect(documentId, blocks) {
        if (blocks == null) return@LaunchedEffect
        snapshotFlow { readyReported }.first { it }
        latestOnReady()
    }
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
    val context = LocalContext.current
    val customTabsPrewarmer = LocalCustomTabsPrewarmer.current
    val linkColor = MaterialTheme.colorScheme.primary
    val linkStyles = remember(linkColor) {
        TextLinkStyles(
            style = SpanStyle(
                color = linkColor,
                textDecoration = TextDecoration.Underline,
            ),
        )
    }
    val linkInteractionListener = remember(context, customTabsPrewarmer) {
        LinkInteractionListener { link ->
            val url = (link as? LinkAnnotation.Url)?.url ?: return@LinkInteractionListener
            openExternalUrl(context, url, session = customTabsPrewarmer?.session)
        }
    }

    // Keep the body layout present during preparation. Returning no node here
    // leaves the Rich-to-Text transition without a replacement layout child.
    SelectionContainer {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .then(if (blocks != null) Modifier.testTag("reader-text-content") else Modifier)
                .onGloballyPositioned {
                    if (blocks != null && !readyReported) {
                        readyReported = true
                    }
                },
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (blocks == null) return@Column
            if (blocks.isEmpty()) {
                Text(
                    text = stringResource(R.string.reader_no_text_content),
                    style = paragraphStyle,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            blocks.forEach { block ->
                when (block) {
                    is ReaderTextBlock.Heading -> ReaderBlockText(
                        block = block,
                        style = headingStyle,
                        color = MaterialTheme.colorScheme.onSurface,
                        linkStyles = linkStyles,
                        linkInteractionListener = linkInteractionListener,
                    )

                    is ReaderTextBlock.Paragraph -> ReaderBlockText(
                        block = block,
                        style = paragraphStyle,
                        color = MaterialTheme.colorScheme.onSurface,
                        linkStyles = linkStyles,
                        linkInteractionListener = linkInteractionListener,
                    )

                    is ReaderTextBlock.Bullet -> Row(
                        verticalAlignment = Alignment.Top,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        DisableSelection {
                            Text(
                                text = "•",
                                style = paragraphStyle,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                        }
                        ReaderBlockText(
                            block = block,
                            style = paragraphStyle,
                            color = MaterialTheme.colorScheme.onSurface,
                            linkStyles = linkStyles,
                            linkInteractionListener = linkInteractionListener,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReaderBlockText(
    block: ReaderTextBlock,
    style: TextStyle,
    color: Color,
    linkStyles: TextLinkStyles,
    linkInteractionListener: LinkInteractionListener,
    modifier: Modifier = Modifier,
) {
    val inlineHtml = block.inlineHtml
    if (inlineHtml == null) {
        Text(
            text = block.text,
            style = style,
            color = color,
            modifier = modifier,
        )
    } else {
        val annotated = remember(inlineHtml, linkStyles, linkInteractionListener) {
            AnnotatedString.fromHtml(
                htmlString = inlineHtml,
                linkStyles = linkStyles,
                linkInteractionListener = linkInteractionListener,
            )
        }
        Text(
            text = annotated,
            style = style,
            color = color,
            modifier = modifier,
        )
    }
}

private fun parseReaderHtmlBlocks(html: String, baseUrl: String?): List<ReaderTextBlock> {
    val mediaFreeHtml = html
        .replace(READER_HTML_COMMENT_REGEX, "")
        .replace(READER_MEDIA_CONTAINER_REGEX, READER_PARAGRAPH_BREAK_MARKER)
        .replace(READER_MEDIA_TAG_REGEX, READER_PARAGRAPH_BREAK_MARKER)
        .replace(READER_NON_TEXT_CONTAINER_REGEX, READER_PARAGRAPH_BREAK_MARKER)

    val structuredHtml = mediaFreeHtml
        .replace(READER_HEADING_OPEN_TAG_REGEX, "$READER_PARAGRAPH_BREAK_MARKER$READER_HEADING_MARKER")
        .replace(READER_HEADING_CLOSE_TAG_REGEX, READER_PARAGRAPH_BREAK_MARKER)
        .replace(READER_LIST_ITEM_OPEN_TAG_REGEX, "$READER_LINE_BREAK_MARKER$READER_BULLET_MARKER")
        .replace(READER_LIST_ITEM_CLOSE_TAG_REGEX, READER_LINE_BREAK_MARKER)
        .replace(READER_LINE_BREAK_TAG_REGEX, READER_LINE_BREAK_MARKER)
        .replace(READER_BLOCK_TAG_REGEX, READER_PARAGRAPH_BREAK_MARKER)
        // Preserve headings/bullets that wrap inner <p> or <div> elements (e.g. <li><p>...</p></li>).
        .replace(READER_LEADING_BULLET_BREAK_REGEX, READER_BULLET_MARKER)
        .replace(READER_LEADING_HEADING_BREAK_REGEX, READER_HEADING_MARKER)

    val blocks = mutableListOf<ReaderTextBlock>()
    val paragraphFragments = mutableListOf<String>()

    fun flushParagraph() {
        if (paragraphFragments.isEmpty()) return
        val combined = paragraphFragments.joinToString(" ")
        paragraphFragments.clear()
        val (plainText, inlineHtml) = extractInlineBlock(combined, baseUrl) ?: return
        if (inlineHtml != null) {
            blocks += ReaderTextBlock.Paragraph(plainText, inlineHtml)
        } else {
            splitLongReaderParagraph(plainText).forEach { blocks += ReaderTextBlock.Paragraph(it) }
        }
    }

    structuredHtml.split(READER_PARAGRAPH_BREAK_MARKER).forEach { paragraphChunk ->
        if (paragraphChunk.isBlank()) {
            flushParagraph()
            return@forEach
        }
        paragraphChunk.split(READER_LINE_BREAK_MARKER).forEach { rawLine ->
            val trimmed = rawLine.trim()
            when {
                trimmed.isEmpty() -> Unit
                trimmed.startsWith(READER_HEADING_MARKER) -> {
                    flushParagraph()
                    extractInlineBlock(trimmed.removePrefix(READER_HEADING_MARKER), baseUrl)
                        ?.let { (plainText, inlineHtml) ->
                            blocks += ReaderTextBlock.Heading(plainText, inlineHtml)
                        }
                }

                trimmed.startsWith(READER_BULLET_MARKER) -> {
                    flushParagraph()
                    extractInlineBlock(trimmed.removePrefix(READER_BULLET_MARKER), baseUrl)
                        ?.let { (plainText, inlineHtml) ->
                            blocks += ReaderTextBlock.Bullet(plainText, inlineHtml)
                        }
                }

                else -> paragraphFragments += trimmed
            }
        }
        flushParagraph()
    }
    flushParagraph()

    return blocks
}

private fun extractInlineBlock(rawHtml: String, baseUrl: String?): Pair<String, String?>? {
    val sanitized = sanitizeReaderInlineHtml(rawHtml, baseUrl)
    val plainText = HtmlCompat.fromHtml(sanitized, HtmlCompat.FROM_HTML_MODE_LEGACY)
        .toString()
        .replace('\uFFFC'.toString(), "")
        .normalizeReaderText()
    if (plainText.isBlank()) return null
    val inlineHtml = sanitized.takeIf { READER_INLINE_TAG_PRESENT_REGEX.containsMatchIn(it) }
    return plainText to inlineHtml
}

/**
 * Retains only safe inline formatting and resolved http/https links so
 * [AnnotatedString.fromHtml] renders crisp links, emphasis, and inline code
 * without leaking publisher styles, scripts, or unsafe URI schemes.
 */
private fun sanitizeReaderInlineHtml(rawHtml: String, baseUrl: String?): String {
    val result = StringBuilder(rawHtml.length)
    var lastIndex = 0
    val openAnchorStack = ArrayDeque<Boolean>()

    READER_HTML_TAG_REGEX.findAll(rawHtml).forEach { match ->
        result.append(rawHtml, lastIndex, match.range.first)
        lastIndex = match.range.last + 1

        val isClosing = match.groupValues[1] == "/"
        val tagName = match.groupValues[2].lowercase()
        val attributes = match.groupValues[3]

        when (tagName) {
            "a" -> if (!isClosing) {
                val safeHref = extractHrefAttribute(attributes)?.let { resolveSafeHttpUrl(it, baseUrl) }
                if (safeHref != null) {
                    openAnchorStack.addLast(true)
                    result.append("<a href=\"").append(escapeHtmlAttribute(safeHref)).append("\">")
                } else {
                    openAnchorStack.addLast(false)
                }
            } else if (openAnchorStack.isNotEmpty() && openAnchorStack.removeLast()) {
                result.append("</a>")
            }

            "code" -> result.append(if (isClosing) "</tt>" else "<tt>")

            "b", "strong", "i", "em", "u", "s", "del", "tt", "sub", "sup" -> {
                result.append(if (isClosing) "</$tagName>" else "<$tagName>")
            }

            else -> Unit
        }
    }
    result.append(rawHtml, lastIndex, rawHtml.length)
    while (openAnchorStack.isNotEmpty()) {
        if (openAnchorStack.removeLast()) result.append("</a>")
    }
    return result.toString().normalizeReaderText()
}

private fun extractHrefAttribute(attributes: String): String? {
    val match = READER_HREF_ATTRIBUTE_REGEX.find(attributes) ?: return null
    val raw = match.groupValues[1].ifEmpty { match.groupValues[2] }.ifEmpty { match.groupValues[3] }
    return HtmlCompat.fromHtml(raw, HtmlCompat.FROM_HTML_MODE_LEGACY).toString().trim()
        .takeIf(String::isNotBlank)
}

private fun resolveSafeHttpUrl(href: String, baseUrl: String?): String? {
    val resolved = if (
        href.startsWith("http://", ignoreCase = true) ||
        href.startsWith("https://", ignoreCase = true)
    ) {
        href
    } else if (!baseUrl.isNullOrBlank()) {
        runCatching { URI(baseUrl).resolve(href).toString() }.getOrNull()
    } else {
        null
    } ?: return null
    return resolved.takeIf {
        it.startsWith("http://", ignoreCase = true) || it.startsWith("https://", ignoreCase = true)
    }
}

private fun escapeHtmlAttribute(value: String): String =
    value
        .replace("&", "&amp;")
        .replace("\"", "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")

private fun parsePlainTextBlocks(source: String): List<ReaderTextBlock> {
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
private const val READER_LINE_BREAK_MARKER = "\uE000br\uE001"
private const val READER_PARAGRAPH_BREAK_MARKER = "\uE000para\uE001"
private const val READER_MIN_PARAGRAPH_LENGTH = 280
private const val READER_IDEAL_PARAGRAPH_LENGTH = 520
private const val READER_MAX_PARAGRAPH_LENGTH = 640
private val READER_SENTENCE_ENDINGS = setOf('.', '!', '?', '…')

private val READER_HTML_COMMENT_REGEX = Regex(
    """<!--.*?-->""",
    RegexOption.DOT_MATCHES_ALL,
)

private val READER_LEADING_BULLET_BREAK_REGEX = Regex(
    """${Regex.escape(READER_BULLET_MARKER)}(?:\s*(?:${Regex.escape(READER_PARAGRAPH_BREAK_MARKER)}|${Regex.escape(READER_LINE_BREAK_MARKER)}))+""",
)

private val READER_LEADING_HEADING_BREAK_REGEX = Regex(
    """${Regex.escape(READER_HEADING_MARKER)}(?:\s*(?:${Regex.escape(READER_PARAGRAPH_BREAK_MARKER)}|${Regex.escape(READER_LINE_BREAK_MARKER)}))+""",
)

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

private val READER_HTML_TAG_REGEX = Regex(
    """<\s*(/?)\s*([a-zA-Z0-9]+)([^>]*)>""",
)

private val READER_HREF_ATTRIBUTE_REGEX = Regex(
    """\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))""",
    RegexOption.IGNORE_CASE,
)

private val READER_INLINE_TAG_PRESENT_REGEX = Regex(
    """<\s*(?:a\b|b>|strong>|i>|em>|u>|s>|del>|tt>|sub>|sup>)""",
    RegexOption.IGNORE_CASE,
)
