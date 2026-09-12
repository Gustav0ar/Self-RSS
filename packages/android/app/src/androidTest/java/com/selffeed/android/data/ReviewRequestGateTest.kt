package com.selffeed.android.data

import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ReviewRequestGateTest {
    @Test
    fun mutationResponsesCanBeDelayedFailedAndReordered() = runTest {
        val repository = FakeSelfFeedRepository()
        val gate = ReviewRequestGate<Pair<String, Boolean>, AppResult<Boolean>>()
        repository.readGate = gate
        val first = async { repository.markRead("article-1", true, "test") }
        val firstRequest = gate.next()
        val second = async { repository.markRead("article-1", false, "test") }
        val secondRequest = gate.next()
        assertEquals("article-1" to true, firstRequest.input)
        assertEquals("article-1" to false, secondRequest.input)
        assertFalse(first.isCompleted)
        secondRequest.response.complete(AppResult.Success(false))
        val secondReceipt = (second.await() as AppResult.Success).data
        assertEquals(secondReceipt.mutationId, (repository.localArticleState("article-1") as AppResult.Success).data.lastReadMutationId)
        assertFalse(first.isCompleted)
        firstRequest.response.complete(AppResult.Error("Rejected fixture change"))
        assertEquals(AppResult.Error("Rejected fixture change"), first.await())
        val detail = repository.article("article-1", forceRefresh = false) as AppResult.Success
        assertFalse(detail.data.isRead)
        val third = async { repository.markRead("article-1", true, "test") }
        gate.next().response.complete(AppResult.Success(true))
        third.await()
        val acceptedDetail = repository.article("article-1", forceRefresh = false) as AppResult.Success
        assertEquals(true, acceptedDetail.data.isRead)
    }
}
