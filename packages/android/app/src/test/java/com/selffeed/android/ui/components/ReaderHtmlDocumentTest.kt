package com.selffeed.android.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaderHtmlDocumentTest {
    @Test
    fun readerHtmlDocumentInjectsThemeAndContrastRepair() {
        val document = buildReaderHtmlDocument(
            html = """
                <div style="background: #fff;">
                    <h2>TL;DR</h2>
                    <ul><li>Contrast should be readable</li></ul>
                </div>
            """.trimIndent(),
            colors = ReaderHtmlColors(
                background = "#000000",
                text = "#EDEDED",
                surface = "#121212",
                mutedText = "#A3A3A3",
                link = "#7C8CFF",
            ),
        )

        assertTrue(document.contains("--reader-background: #000000;"))
        assertTrue(document.contains("minimumReadableContrast = 4.5"))
        assertTrue(document.contains("effectiveBackground(element)"))
        assertTrue(document.contains("textOnLightBackground: '#111827'"))
        assertTrue(document.contains("-webkit-text-fill-color"))
        assertTrue(document.contains("TL;DR"))
        assertTrue(document.contains("prepareEmbeds()"))
        assertTrue(document.contains("allowfullscreen"))
        assertTrue(document.contains("picture-in-picture; web-share"))
        assertTrue(document.contains("fallbackChecks >= 10"))
        assertTrue(document.contains("clearInterval(fallbackTimer)"))
    }

    @Test
    fun readerHtmlDocumentSanitizesUnsafeHtmlBeforeInjection() {
        val document = buildReaderHtmlDocument(
            html = """
                <p onclick="alert(1)">Safe text</p>
                <a href="javascript:alert(1)">Bad link</a>
                <script>alert(1)</script>
                <iframe src="https://notyoutube.com/watch?v=abc"></iframe>
                <iframe src="https://www.youtube.com/embed/abc"></iframe>
            """.trimIndent(),
            colors = ReaderHtmlColors(
                background = "#000000",
                text = "#EDEDED",
                surface = "#121212",
                mutedText = "#A3A3A3",
                link = "#7C8CFF",
            ),
        )

        assertTrue(document.contains("Safe text"))
        assertTrue(document.contains("Bad link"))
        assertTrue(document.contains("https://www.youtube.com/embed/abc"))
        assertTrue(!document.contains("onclick="))
        assertTrue(!document.contains("javascript:alert"))
        assertTrue(!document.contains("<script>alert"))
        assertTrue(!document.contains("notyoutube.com"))
    }

    @Test
    fun sanitizeReaderHtmlKeepsPlainTextUnchanged() {
        assertEquals("Just text", sanitizeReaderHtml("Just text"))
    }

    @Test
    fun readerDocumentBaseUrlUsesFirstHttpUrl() {
        assertEquals(
            "https://www.androidauthority.com/samsung-google-privacy-preserving-permissions-3676122/",
            readerDocumentBaseUrl(
                "mailto:tips@example.com",
                "https://www.androidauthority.com/samsung-google-privacy-preserving-permissions-3676122/",
            ),
        )
    }

    @Test
    fun readerDocumentBaseUrlFallsBackForInvalidUrls() {
        assertEquals(
            DefaultReaderDocumentBaseUrl,
            readerDocumentBaseUrl(null, "", "not a url", "ftp://example.com/article"),
        )
    }
}
