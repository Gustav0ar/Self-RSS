package com.selffeed.android.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ReaderTextContentTest {
    @Test
    fun htmlTextModeKeepsReadingStructureAndRemovesMedia() {
        val blocks = readerTextBlocks(
            html = """
                <p>Opening paragraph with an &amp; character.</p>
                <figure>
                    <img src="https://example.com/hero.jpg" alt="A hero image" />
                    <figcaption>This image caption must not appear in Text mode.</figcaption>
                </figure>
                <h2>What matters</h2>
                <p>The second paragraph remains easy to read.</p>
                <ul>
                    <li>First useful point</li>
                    <li>Second useful point</li>
                </ul>
                <video controls><source src="https://example.com/demo.mp4" />Video fallback text</video>
                <iframe src="https://www.youtube.com/embed/abc">Video fallback text</iframe>
            """.trimIndent(),
            text = "The HTML structure should be preferred when it is available.",
        )

        assertEquals(
            listOf(
                ReaderTextBlock.Paragraph("Opening paragraph with an & character."),
                ReaderTextBlock.Heading("What matters"),
                ReaderTextBlock.Paragraph("The second paragraph remains easy to read."),
                ReaderTextBlock.Bullet("First useful point"),
                ReaderTextBlock.Bullet("Second useful point"),
            ),
            blocks,
        )
        assertFalse(blocks.any { "hero image" in it.text || "caption" in it.text || "Video fallback" in it.text })
    }

    @Test
    fun plainTextFallsBackToComfortableParagraphLengths() {
        val sentence = "This sentence is intentionally long enough to make a comfortable reading paragraph when repeated."
        val source = List(12) { sentence }.joinToString(" ")

        val blocks = readerTextBlocks(html = null, text = source)

        assertTrue(blocks.size > 1)
        assertTrue(blocks.all { it is ReaderTextBlock.Paragraph })
        assertEquals(source, blocks.joinToString(" ") { it.text })
        assertTrue(blocks.all { it.text.length <= 640 })
    }

    @Test
    fun plainTextNewlinesRemainSeparateParagraphs() {
        val blocks = readerTextBlocks(
            html = null,
            text = "First paragraph.\n\nSecond paragraph.",
        )

        assertEquals(
            listOf(
                ReaderTextBlock.Paragraph("First paragraph."),
                ReaderTextBlock.Paragraph("Second paragraph."),
            ),
            blocks,
        )
    }
}
