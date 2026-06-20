package com.selffeed.android.ui.utils

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaTrustTest {
    @Test
    fun `trusted embed urls are accepted`() {
        assertTrue(isTrustedEmbedUrl("https://www.youtube.com/embed/abc"))
        assertTrue(isTrustedEmbedUrl("https://player.vimeo.com/video/123"))
        assertTrue(isTrustedEmbedUrl("https://streamable.com/e/xyz"))
    }

    @Test
    fun `unknown hosts are rejected`() {
        assertFalse(isTrustedEmbedUrl("https://evil.example/embed"))
        assertFalse(isTrustedEmbedUrl("javascript:alert(1)"))
        assertFalse(isTrustedEmbedUrl("ftp://www.youtube.com/embed/abc"))
        assertFalse(isTrustedEmbedUrl(null))
    }

    @Test
    fun `lookalike media hosts are rejected`() {
        assertFalse(isTrustedEmbedUrl("https://notyoutube.com/watch?v=abc"))
        assertFalse(isTrustedEmbedUrl("https://evilplayer.vimeo.com/video/123"))
        assertFalse(isTrustedEmbedUrl("https://notstreamable.com/e/xyz"))
        assertFalse(isTrustedEmbedUrl("https://platform.twitter.com.evil.example/embed/Tweet.html?id=1"))
    }

    @Test
    fun `preview allowed only for trusted provider and url`() {
        assertTrue(canPreviewMedia("youtube", "https://youtube.com/embed/abc"))
        assertFalse(canPreviewMedia("unknown", "https://youtube.com/embed/abc"))
        assertFalse(canPreviewMedia("youtube", "https://evil.example/embed"))
    }

    @Test
    fun `youtube thumbnail extraction rejects lookalike hosts`() {
        assertEquals(
            "https://img.youtube.com/vi/abc_123-XYZ/0.jpg",
            getYouTubeThumbnail("https://www.youtube.com/watch?v=abc_123-XYZ"),
        )
        assertEquals(
            "https://img.youtube.com/vi/abc123/0.jpg",
            getYouTubeThumbnail("https://youtu.be/abc123"),
        )
        assertNull(getYouTubeThumbnail("https://notyoutube.com/watch?v=abc123"))
    }
}
