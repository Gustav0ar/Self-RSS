package com.selffeed.android.ui

import androidx.paging.LoadState
import com.selffeed.android.network.ArticleListItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ArticleSnapshotSynchronizationTest {
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
}
