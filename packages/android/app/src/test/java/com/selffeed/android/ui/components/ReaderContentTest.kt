package com.selffeed.android.ui.components

import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleMedia
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaderContentTest {
    @Test
    fun `late partial update cannot remove rendered text or media`() {
        val complete = article(
            text = "The complete article body has several paragraphs of useful reading.",
            media = listOf(media("image-1", "https://example.com/hero.jpg")),
            contentVersion = 2,
        )
        val stalePartial = article(
            text = "The complete article body has",
            media = emptyList(),
            contentVersion = 1,
        )

        val merged = complete.readerContent().mergeNonRegressive(stalePartial)

        assertEquals(complete.contentText, merged.text)
        assertEquals(listOf("image-1"), merged.media.map { it.id })
        assertEquals(2, merged.contentVersion)
    }

    @Test
    fun `richer update extends the reader without dropping existing media`() {
        val initial = article(
            text = "Short feed excerpt",
            media = listOf(media("image-1", "https://example.com/hero.jpg")),
            contentVersion = 1,
        )
        val enriched = article(
            text = "Short feed excerpt followed by the complete canonical article body.",
            media = listOf(media("image-2", "https://example.com/inline.jpg")),
            contentVersion = 2,
        )

        val merged = initial.withNonRegressiveReaderContent(enriched)

        assertEquals(enriched.contentText, merged.contentText)
        assertEquals(listOf("image-1", "image-2"), merged.media.map { it.id })
        assertTrue(merged.isEnriched)
    }

    @Test
    fun `same image URL from a refresh keeps one stable renderer`() {
        val initial = article(
            text = "Article body",
            media = listOf(media("first-id", "https://example.com/hero.jpg")),
            contentVersion = 1,
        )
        val refreshed = article(
            text = "Article body with more content",
            media = listOf(media("replacement-id", "https://example.com/hero.jpg")),
            contentVersion = 2,
        )

        val merged = initial.readerContent().mergeNonRegressive(refreshed)

        assertEquals(1, merged.media.size)
        assertEquals("first-id", merged.media.single().id)
        assertEquals("image:https://example.com/hero.jpg", merged.media.single().readerRenderKey())
    }

    @Test
    fun `reader image aspect ratio uses metadata and has stable fallback`() {
        assertEquals(4f / 3f, media("landscape", "https://example.com/a.jpg", width = 1200, height = 900).readerImageAspectRatio())
        assertEquals(16f / 9f, media("unknown", "https://example.com/b.jpg").readerImageAspectRatio())
    }

    private fun article(
        text: String,
        media: List<ArticleMedia>,
        contentVersion: Int,
    ) = ArticleDetail(
        id = "article-1",
        feedId = "feed-1",
        guid = "article-1",
        title = "Article",
        contentText = text,
        hash = "hash",
        feedTitle = "Feed",
        media = media,
        isRead = false,
        isEnriched = contentVersion > 1,
        contentVersion = contentVersion,
    )

    private fun media(id: String, url: String, width: Int? = null, height: Int? = null) = ArticleMedia(
        id = id,
        articleId = "article-1",
        type = "image",
        provider = "unknown",
        url = url,
        width = width,
        height = height,
        position = 0,
    )
}
