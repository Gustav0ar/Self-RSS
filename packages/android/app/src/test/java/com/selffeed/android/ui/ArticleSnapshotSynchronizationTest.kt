package com.selffeed.android.ui

import androidx.paging.LoadState
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.screens.readerQueueForTappedArticle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ArticleSnapshotSynchronizationTest {
	private val tappedArticle = ArticleListItem(
		id = "tapped",
		feedId = "feed-1",
		feedTitle = "Feed",
		title = "Tapped article",
		isRead = false,
	)

    @Test
    fun `settled empty generation is published as authoritative state`() {
        assertEquals(
            emptyList<ArticleListItem>(),
            settledArticleSnapshot(
                snapshot = emptyList(),
                refreshState = LoadState.NotLoading(endOfPaginationReached = true),
            ),
        )
    }

    @Test
	fun `loading generation does not clear the last settled snapshot early`() {
        assertNull(
            settledArticleSnapshot(
                snapshot = emptyList(),
                refreshState = LoadState.Loading,
            ),
        )
	}

	@Test
	fun `tap queue retains the visible row when paging already published an empty generation`() {
		assertEquals(listOf(tappedArticle), readerQueueForTappedArticle(emptyList(), tappedArticle))
	}

	@Test
	fun `tap queue preserves paging order when the visible row is still in the snapshot`() {
		val other = tappedArticle.copy(id = "other", title = "Other article")
		assertEquals(
			listOf(other, tappedArticle),
			readerQueueForTappedArticle(listOf(other, tappedArticle), tappedArticle),
		)
	}
}
