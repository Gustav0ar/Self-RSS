package com.selffeed.android.ui.components

import com.selffeed.android.ui.ReaderAppearance
import com.selffeed.android.ui.ReaderFontPreference
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
        assertTrue(document.contains(".reader-summary-block"))
        assertTrue(document.contains("background: var(--reader-surface) !important;"))
        assertTrue(document.contains("color: var(--reader-text) !important;"))
        assertTrue(document.contains("border-left: 3px solid var(--reader-link);"))
        assertTrue(document.contains("markReaderSummaryBlocks(container)"))
        assertTrue(document.contains("summaryBlockFor(heading, container)"))
        assertTrue(document.contains("tl\\s*;?\\s*dr"))
        assertTrue(document.contains("prepareEmbeds()"))
        assertTrue(document.contains("allowfullscreen"))
        assertTrue(document.contains("picture-in-picture; web-share"))
        assertTrue(document.contains("fallbackChecks >= 10"))
        assertTrue(document.contains("clearInterval(fallbackTimer)"))
        assertTrue(document.contains("let pendingHeightUpdate = null"))
        assertTrue(document.contains("setTimeout(() =>"))
        assertTrue(document.contains("}, 120)"))
        assertTrue(document.contains("maximum-scale=5.0, user-scalable=yes"))
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

    @Test
    fun readerHtmlDocumentAppliesTheSelectedReaderAppearance() {
        val document = buildReaderHtmlDocument(
            html = "<p>Readable</p>",
            colors = ReaderHtmlColors("#000", "#fff", "#111", "#aaa", "#88f"),
            appearance = ReaderAppearance(textSizeSp = 20, font = ReaderFontPreference.SERIF),
            textScale = 1.2f,
        )

        assertTrue(document.contains("font-family: Georgia"))
        assertTrue(document.contains("font-size: 24px"))
    }
}
