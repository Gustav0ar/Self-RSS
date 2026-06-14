package com.selffeed.android.ui

import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArticleReadStateStoreTest {
    @Test
    fun snapshot_prefersRememberedStateOverStaleListState() {
        val store = ArticleReadStateStore()
        store.remember("a1", true)

        val snapshot = store.snapshot(
            articles = listOf(sampleArticle(id = "a1", isRead = false)),
            searchResults = emptyList(),
            selectedArticle = null,
        )

        assertTrue(snapshot.getValue("a1"))
    }

    @Test
    fun snapshot_fallsBackToVisibleStateWhenNoOverrideExists() {
        val store = ArticleReadStateStore()

        val snapshot = store.snapshot(
            articles = listOf(sampleArticle(id = "a1", isRead = false)),
            searchResults = listOf(sampleArticle(id = "a2", isRead = true)),
            selectedArticle = sampleArticleDetail(id = "a3", isRead = true),
        )

        assertFalse(snapshot.getValue("a1"))
        assertTrue(snapshot.getValue("a2"))
        assertTrue(snapshot.getValue("a3"))
    }

    @Test
    fun clear_removesRememberedOverrides() {
        val store = ArticleReadStateStore()
        store.remember("a1", true)
        store.clear()

        val snapshot = store.snapshot(
            articles = listOf(sampleArticle(id = "a1", isRead = false)),
            searchResults = emptyList(),
            selectedArticle = null,
        )

        assertEquals(false, snapshot.getValue("a1"))
    }

    private fun sampleArticle(
        id: String,
        isRead: Boolean,
    ): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Feed",
        title = "Article $id",
        isRead = isRead,
    )

    private fun sampleArticleDetail(
        id: String,
        isRead: Boolean,
    ): ArticleDetail = ArticleDetail(
        id = id,
        feedId = "feed-1",
        guid = id,
        canonicalUrl = null,
        title = "Article $id",
        author = null,
        excerpt = null,
        contentHtml = null,
        contentText = null,
        heroImageUrl = null,
        publishedAt = null,
        fetchedAt = null,
        hash = id,
        feedTitle = "Feed",
        feedFaviconUrl = null,
        feedSiteUrl = null,
        media = emptyList(),
        isRead = isRead,
        isEnriched = false,
    )
}
