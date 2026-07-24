package com.selffeed.android.ui

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.R
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], qualifiers = "en")
class PresentationTextTest {
    private val resources
        get() = ApplicationProvider.getApplicationContext<Context>().resources

    @Test
    fun `resource arguments resolve with default locale semantics`() {
        assertEquals(
            "Loading A long article",
            PresentationText.resource(
                R.string.reader_loading_article,
                "A long article",
            ).resolve(resources),
        )
        assertEquals(
            "Refreshing feeds in background · 3/8",
            PresentationText.resource(
                R.string.feeds_sync_background_progress,
                3,
                8,
            ).resolve(resources),
        )
    }

    @Test
    fun `plurals select singular and plural forms`() {
        assertEquals(
            "Marked 1 article as read",
            PresentationText.plural(R.plurals.article_marked_all_read, 1).resolve(resources),
        )
        assertEquals(
            "Marked 4 articles as read",
            PresentationText.plural(R.plurals.article_marked_all_read, 4).resolve(resources),
        )
    }

    @Test
    fun `joined and nested text resolve only at the UI boundary`() {
        val summary = PresentationText.joined(
            listOf(
                PresentationText.plural(R.plurals.feeds_sync_new_articles, 1),
                PresentationText.plural(R.plurals.feeds_sync_failed_feeds, 2),
            ),
        )
        val warning = PresentationText.resource(
            R.string.feeds_health_warning,
            "Example",
            PresentationText.dynamic("Connection timed out."),
            PresentationText.dynamic(""),
        )

        assertEquals("1 new article · 2 feeds failed", summary.resolve(resources))
        assertEquals(
            "Example is not updating. Connection timed out.",
            warning.resolve(resources),
        )
    }

    @Test
    fun `dynamic server messages remain unchanged`() {
        assertEquals(
            "Server supplied message",
            PresentationText.dynamic("Server supplied message").resolve(resources),
        )
    }
}
