package com.selffeed.android.ui.articles

import com.selffeed.android.data.repository.ArticleMutationReceipt
import com.selffeed.android.data.repository.LocalArticleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArticleStateProjectionTest {
    private val projection = ArticleStateProjection()
    private val ids = setOf("article")
    private fun observed(read: Boolean, saved: Boolean = false, readId: String? = null, savedId: String? = null) =
        mapOf("article" to LocalArticleState(read, saved, lastReadMutationId = readId, lastSavedMutationId = savedId))

    @Test fun roomCanPublishBeforeOrAfterTheQueueReturnsWithoutDroppingTheChoiceEarly() {
        for (roomFirst in listOf(true, false)) {
            projection.clear()
            projection.retain(ids)
            projection.accept(projection.observation.value, observed(false))
            val action = projection.begin("article", ArticleStateProjection.Field.Read, true)
            if (roomFirst) projection.accept(projection.observation.value, observed(true, readId = "choice"))
            projection.committed(action, ArticleMutationReceipt("choice"))
            assertEquals(true, projection.flags.value["article"]?.isRead)
            if (!roomFirst) projection.accept(projection.observation.value, observed(true, readId = "choice"))
            projection.accept(projection.observation.value, observed(false, readId = "choice"))
            assertEquals(false, projection.flags.value["article"]?.isRead)
        }
    }

    @Test fun olderCompletionAndRoomReceiptCannotReplaceTheLatestTap() {
        projection.retain(ids)
        val first = projection.begin("article", ArticleStateProjection.Field.Read, true)
        val latest = projection.begin("article", ArticleStateProjection.Field.Read, false)
        projection.committed(first, ArticleMutationReceipt("old"))
        projection.failed(first)
        projection.accept(projection.observation.value, observed(true, readId = "old"))
        assertEquals(false, projection.flags.value["article"]?.isRead)
        projection.committed(latest, ArticleMutationReceipt("latest"))
        assertEquals(false, projection.flags.value["article"]?.isRead)
        projection.accept(projection.observation.value, observed(true, readId = "latest"))
        assertEquals(true, projection.flags.value["article"]?.isRead)
    }

    @Test fun readAndSavedChoicesSettleIndependentlyIncludingRejectedValues() {
        projection.retain(ids)
        val read = projection.begin("article", ArticleStateProjection.Field.Read, true)
        val saved = projection.begin("article", ArticleStateProjection.Field.Saved, true)
        projection.committed(read, ArticleMutationReceipt("read"))
        projection.accept(projection.observation.value, observed(false, readId = "read"))
        assertEquals(ArticleFlags(false, true), projection.flags.value["article"])
        projection.committed(saved, ArticleMutationReceipt("saved"))
        projection.accept(projection.observation.value, observed(false, false, "read", "saved"))
        assertEquals(ArticleFlags(false, false), projection.flags.value["article"])
    }

    @Test fun leavingAWindowDropsSettledStateAndFinishingAnOffscreenActionDropsItsReceipt() {
        projection.retain(ids)
        projection.accept(projection.observation.value, observed(false))
        val action = projection.begin("article", ArticleStateProjection.Field.Read, true)
        projection.retain(setOf("next"))
        assertEquals(setOf("article", "next"), projection.observation.value.articleIds)
        projection.committed(action, ArticleMutationReceipt("choice"))
        assertEquals(setOf("next"), projection.observation.value.articleIds)
        assertFalse("article" in projection.flags.value)
        assertTrue(projection.flags.value.isEmpty())
    }

    @Test fun unknownStoredValuesStayUnknownAndFailureReleasesOnlyItsOwnOverride() {
        projection.retain(ids)
        projection.accept(projection.observation.value, mapOf("article" to LocalArticleState(null, null)))
        val read = projection.begin("article", ArticleStateProjection.Field.Read, true)
        projection.begin("article", ArticleStateProjection.Field.Saved, true)
        projection.failed(read)
        assertEquals(ArticleFlags(null, true), projection.flags.value["article"])
        projection.clear()
        assertTrue(projection.observation.value.articleIds.isEmpty())
        assertTrue(projection.flags.value.isEmpty())
    }
    @Test fun revisitingAWindowAndRestartingTheForegroundRejectOldSameIdCallbacks() {
        projection.retain(ids)
        val first = projection.observation.value
        projection.retain(setOf("next"))
        projection.retain(ids)
        projection.accept(projection.observation.value, observed(true))
        projection.accept(first, observed(false))
        assertEquals(true, projection.flags.value["article"]?.isRead)
        val beforeStop = projection.observation.value
        projection.restartObservation()
        projection.accept(beforeStop, observed(false))
        assertEquals(true, projection.flags.value["article"]?.isRead)
        projection.clear()
        projection.retain(ids)
        projection.accept(beforeStop, observed(false))
        assertTrue(projection.flags.value.isEmpty())
    }

    @Test fun unknownRejectionAndSupersededFailureRestoreThePreActionDisplayValue() {
        projection.retain(ids)
        val first = projection.begin("article", ArticleStateProjection.Field.Read, true, previousValue = false)
        val latest = projection.begin("article", ArticleStateProjection.Field.Read, true, previousValue = true)
        projection.failed(first)
        projection.accept(projection.observation.value, observed(true, readId = "latest"))
        projection.committed(latest, ArticleMutationReceipt("latest"))
        projection.accept(projection.observation.value, mapOf("article" to LocalArticleState(
            null, null, lastReadMutationId = "latest",
        )))
        assertEquals(false, projection.flags.value["article"]?.isRead)
        projection.retain(setOf("next"))
        projection.retain(ids)
        assertTrue(projection.flags.value.isEmpty())
    }

    @Test fun laterIndependentChoiceUsesNewlyConfirmedStateAsItsDisplayFallback() {
        projection.retain(ids)
        projection.accept(projection.observation.value, observed(false))
        val first = projection.begin("article", ArticleStateProjection.Field.Read, true, previousValue = false)
        projection.committed(first, ArticleMutationReceipt("first"))
        projection.accept(projection.observation.value, observed(true, readId = "first"))
        val next = projection.begin("article", ArticleStateProjection.Field.Read, false, previousValue = true)
        projection.accept(projection.observation.value, mapOf("article" to LocalArticleState(null, null)))
        projection.failed(next)
        assertEquals(true, projection.flags.value["article"]?.isRead)
    }

    @Test fun failedSubmissionWithoutStoredStateRestoresItsOriginalDisplayValue() {
        projection.retain(ids)
        val action = projection.begin("article", ArticleStateProjection.Field.Saved, true, previousValue = false)
        projection.failed(action)
        assertEquals(false, projection.flags.value["article"]?.isSaved)
        projection.clear()
        projection.retain(ids)
        assertTrue(projection.flags.value.isEmpty())
    }

}
