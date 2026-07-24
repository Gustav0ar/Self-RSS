package com.selffeed.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class ExternalActionParserTest {
    @Test
    fun `parses an article link with a matching secure server origin`() {
        val action = parseSelfFeedAction(
            "selffeed://article/123e4567-e89b-12d3-a456-426614174000" +
                "?server=https%3A%2F%2Frss.example.com",
        )

        assertEquals(
            ExternalAction.OpenArticle(
                articleId = "123e4567-e89b-12d3-a456-426614174000",
                serverOrigin = "https://rss.example.com",
            ),
            action,
        )
    }

    @Test
    fun `parses an encoded https feed url`() {
        val feed = "https://example.com/feed.xml?edition=world"
        val action = parseSelfFeedAction(
            "selffeed://add-feed?url=" +
                URLEncoder.encode(feed, StandardCharsets.UTF_8),
        )

        assertEquals(ExternalAction.AddFeed(feed), action)
    }

    @Test
    fun `rejects insecure credentials fragments duplicate and unsupported parameters`() {
        val id = "123e4567-e89b-12d3-a456-426614174000"
        listOf(
            "selffeed://article/not-a-uuid",
            "selffeed://article/$id?server=http%3A%2F%2Frss.example.com",
            "selffeed://article/$id?server=https%3A%2F%2Fu%3Ap%40rss.example.com",
            "selffeed://article/$id?server=https%3A%2F%2Frss.example.com%2Fpath",
            "selffeed://article/$id?extra=1",
            "selffeed://add-feed?url=https%3A%2F%2Fexample.com%2Ffeed%23fragment",
            "selffeed://add-feed?url=https%3A%2F%2Fa.example%2Ffeed&url=https%3A%2F%2Fb.example%2Ffeed",
        ).forEach { assertNull(it, parseSelfFeedAction(it)) }
    }

    @Test
    fun `shared text only accepts one https url`() {
        assertEquals(
            ExternalAction.AddFeed("https://example.com/feed"),
            parseSharedFeedAction("  https://example.com/feed  "),
        )
        assertNull(parseSharedFeedAction("http://example.com/feed"))
        assertNull(parseSharedFeedAction("read https://example.com/feed"))
    }
}
