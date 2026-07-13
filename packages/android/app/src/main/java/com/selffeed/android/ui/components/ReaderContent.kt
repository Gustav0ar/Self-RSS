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
        // Extraction can assign a fresh database id to the same URL after an
        // article refresh. Use the actual render source as identity so that
        // update cannot add a second image (and force a visible relayout).
        media = (media + next.media).distinctBy(ArticleMedia::readerRenderKey),
        contentVersion = maxOf(contentVersion, next.contentVersion),
    )
}

/** Stable Compose identity for an article-media renderer. */
internal fun ArticleMedia.readerRenderKey(): String = when {
    type == "image" && url.isNotBlank() -> "image:$url"
    !embedUrl.isNullOrBlank() -> "$type:$embedUrl"
    url.isNotBlank() -> "$type:$url"
    else -> "$type:$id"
}

/**
 * Reserving the known image geometry prevents AsyncImage's loading and
 * success painters from changing the reader's layout. Media without usable
 * dimensions gets a conventional landscape placeholder.
 */
internal fun ArticleMedia.readerImageAspectRatio(): Float {
    val imageWidth = width?.takeIf { it > 0 } ?: return 16f / 9f
    val imageHeight = height?.takeIf { it > 0 } ?: return 16f / 9f
    return imageWidth.toFloat() / imageHeight
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
