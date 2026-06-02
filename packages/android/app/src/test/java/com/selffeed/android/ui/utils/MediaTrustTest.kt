package com.selffeed.android.ui.utils

import org.junit.Assert.assertFalse
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
        assertFalse(isTrustedEmbedUrl(null))
    }

    @Test
    fun `preview allowed only for trusted provider and url`() {
        assertTrue(canPreviewMedia("youtube", "https://youtube.com/embed/abc"))
        assertFalse(canPreviewMedia("unknown", "https://youtube.com/embed/abc"))
        assertFalse(canPreviewMedia("youtube", "https://evil.example/embed"))
    }
}
