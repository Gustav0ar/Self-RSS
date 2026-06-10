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
