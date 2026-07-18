package com.selffeed.android.network

import com.squareup.moshi.Types
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class FeedMutationContractTest {
    private val moshi = NetworkModule.provideMoshi()
    private val envelopeType = Types.newParameterizedType(
        ApiEnvelope::class.java,
        FeedWithCounts::class.java,
    )
    private val adapter = moshi.adapter<ApiEnvelope<FeedWithCounts>>(envelopeType)

    @Test
    fun `create and update response fixture decodes unread count`() {
        val response = adapter.fromJson(
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

        assertNotNull(response)
        assertEquals("Example Feed", response?.data?.title)
        assertEquals(7, response?.data?.unreadCount)
    }
}
