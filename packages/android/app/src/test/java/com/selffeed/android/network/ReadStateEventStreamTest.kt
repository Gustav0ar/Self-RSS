package com.selffeed.android.network

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadStateEventStreamTest {
    private val adapter = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()
        .adapter(ReadStateEventPayload::class.java)

    @Test
    fun parser_handlesCommentsCrLfSplitAndMultiLineData() {
        val parser = SseEventParser()

        assertNull(parser.pushLine(": keepalive"))
        assertNull(parser.pushLine("event: read-state\r"))
        assertNull(parser.pushLine("data: first"))
        assertNull(parser.pushLine("data: second"))

        val message = parser.pushLine("")

        assertEquals("read-state", message?.eventName)
        assertEquals("first\nsecond", message?.data)
    }

    @Test
    fun parser_convertsValidReadStatePayloadAndIgnoresInvalidEvents() {
        val connected = SseMessage(eventName = "read-state.connected", data = "{}")
        val invalidType = SseMessage(eventName = "read-state", data = """{"type":"unknown"}""")
        val readState = SseMessage(
            eventName = "read-state",
            data = """{"type":"article.read_state_changed","eventId":"event-1","articleId":"article-1","feedId":"feed-1","isRead":true,"source":"manual","clientId":"web-client","updatedAt":"2026-06-01T00:00:00.000Z"}""",
        )

        assertNull(connected.toReadStateEvent(adapter))
        assertNull(invalidType.toReadStateEvent(adapter))

        val event = readState.toReadStateEvent(adapter)

        assertTrue(event is ArticleReadStateChangedEvent)
        event as ArticleReadStateChangedEvent
        assertEquals("article-1", event.articleId)
        assertEquals("feed-1", event.feedId)
        assertTrue(event.isRead)
        assertEquals("web-client", event.clientId)
    }
}
