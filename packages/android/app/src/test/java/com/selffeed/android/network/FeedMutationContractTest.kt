package com.selffeed.android.network

import org.junit.Assert.assertEquals
import org.junit.Test

class FeedMutationContractTest {
    private val json = NetworkModule.provideJson()
    private val envelopeSerializer = ApiEnvelope.serializer(FeedWithCounts.serializer())

    @Test
    fun `category reorder matches the existing API request and response`() {
        val request = ReorderCategoriesRequest(listOf(CategoryOrderUpdate("second", 0), CategoryOrderUpdate("first", 1)))
        assertEquals(
            """{"updates":[{"id":"second","sortOrder":0},{"id":"first","sortOrder":1}]}""",
            json.encodeToString(ReorderCategoriesRequest.serializer(), request),
        )
        assertEquals(
            2,
            json.decodeFromString(ReorderCategoriesResponse.serializer(), """{"updatedCount":2}""").updatedCount,
        )
    }

    @Test
    fun `create and update response fixture decodes unread count`() {
        val response = json.decodeFromString(
            envelopeSerializer,
            """
            {
              "data": {
                "id": "5e970087-6901-4268-9045-2cb4b49cf93f",
                "userId": "dd497b52-4793-48ce-a67e-f1fd6207c93f",
                "categoryId": "f6dc3f0c-0987-41ef-a72a-7a25352983c2",
                "title": "Example Feed",
                "siteUrl": "https://example.com/",
                "feedUrl": "https://example.com/feed.xml",
                "faviconUrl": null,
                "description": "Example feed description",
                "pollingIntervalMinutes": 60,
                "lastSyncedAt": null,
                "lastSyncError": null,
                "lastSyncErrorAt": null,
                "syncStatus": "idle",
                "createdAt": "2026-07-17T10:00:00.000Z",
                "updatedAt": "2026-07-17T10:00:00.000Z",
                "unreadCount": 7
              }
            }
            """.trimIndent(),
        )

        assertEquals("Example Feed", response.data.title)
        assertEquals(7, response.data.unreadCount)
    }
}
