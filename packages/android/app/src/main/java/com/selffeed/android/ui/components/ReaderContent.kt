package com.selffeed.android.ui.components

import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleMedia

/**
 * The content currently safe to render in a reader session.
 *
 * Reader details can arrive from the list cache, the detail endpoint, and
 * canonical enrichment in a different order. Rendering every payload as-is
 * lets a late, less-complete payload remove paragraphs or media the reader has
 * already seen. Keep content monotonic for the lifetime of an opened article.
 */
internal data class ReaderContent(
    val html: String?,
    val text: String?,
    val media: List<ArticleMedia>,
    val contentVersion: Int,
)

internal fun ArticleDetail.readerContent(): ReaderContent = ReaderContent(
    html = contentHtml?.takeIf(String::isNotBlank),
    text = contentText?.takeIf(String::isNotBlank),
    media = media,
    contentVersion = contentVersion,
)

internal fun ReaderContent.mergeNonRegressive(incoming: ArticleDetail): ReaderContent {
    val next = incoming.readerContent()
    return ReaderContent(
        html = preferCompleteContent(html, next.html),
        text = preferCompleteContent(text, next.text),
        media = (media + next.media).distinctBy { media -> media.id.ifBlank { media.url } },
        contentVersion = maxOf(contentVersion, next.contentVersion),
    )
}

/** Applies the reader-safe content merge while retaining fresh article metadata. */
internal fun ArticleDetail.withNonRegressiveReaderContent(incoming: ArticleDetail): ArticleDetail {
    require(id == incoming.id) { "Cannot merge content from different articles" }
    val content = readerContent().mergeNonRegressive(incoming)
    return incoming.copy(
        contentHtml = content.html,
        contentText = content.text,
        media = content.media,
        isEnriched = isEnriched || incoming.isEnriched,
        contentVersion = content.contentVersion,
    )
}

private fun preferCompleteContent(current: String?, incoming: String?): String? = when {
    incoming.isNullOrBlank() -> current
    current.isNullOrBlank() -> incoming
    incoming.length >= current.length -> incoming
    else -> current
}
