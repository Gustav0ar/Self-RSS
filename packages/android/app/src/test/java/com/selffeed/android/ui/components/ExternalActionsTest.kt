package com.selffeed.android.ui.components

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.service.chooser.ChooserAction
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExternalActionsTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun shareChooserAddsPreviewTitleAndAndroid14CustomActions() {
        val chooser = buildShareArticleChooserIntent(
            context = context,
            title = "Modern Android Reader",
            url = "https://example.com/articles/1",
        )

        assertNotNull(chooser)
        assertEquals("Modern Android Reader", chooser!!.getStringExtra(Intent.EXTRA_TITLE))
        val target = chooser.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        assertNotNull(target)
        assertEquals("Modern Android Reader\nhttps://example.com/articles/1", target!!.getStringExtra(Intent.EXTRA_TEXT))
        assertEquals("https://example.com/articles/1", target.clipData?.getItemAt(0)?.text?.toString())

        val actions = chooser.getParcelableArrayExtra(
            Intent.EXTRA_CHOOSER_CUSTOM_ACTIONS,
            ChooserAction::class.java,
        )
        assertNotNull(actions)
        assertEquals(listOf("Copy link", "Open in browser"), actions!!.map { it.label.toString() })
    }

    @Test
    fun shareChooserRejectsNonHttpUrls() {
        assertNull(buildShareArticleChooserIntent(context, "Unsafe", "javascript:alert(1)"))
        assertNull(buildShareArticleChooserIntent(context, "Missing", null))
    }

    @Test
    fun shareActionReceiverCopiesValidLinkToClipboardAndIgnoresInvalidSchemes() {
        val receiver = ShareActionReceiver()
        val clipboard = context.getSystemService(ClipboardManager::class.java)!!

        receiver.onReceive(
            context,
            Intent(ShareActionReceiver.ACTION_COPY_ARTICLE_LINK).apply {
                putExtra(ShareActionReceiver.EXTRA_ARTICLE_TITLE, "Modern Android Reader")
                putExtra(ShareActionReceiver.EXTRA_ARTICLE_URL, "https://example.com/articles/1")
            },
        )
        assertEquals(
            "https://example.com/articles/1",
            clipboard.primaryClip?.getItemAt(0)?.text?.toString(),
        )

        receiver.onReceive(
            context,
            Intent(ShareActionReceiver.ACTION_COPY_ARTICLE_LINK).apply {
                putExtra(ShareActionReceiver.EXTRA_ARTICLE_URL, "file:///etc/passwd")
            },
        )
        assertEquals(
            "https://example.com/articles/1",
            clipboard.primaryClip?.getItemAt(0)?.text?.toString(),
        )
    }

    @Test
    fun assistWebUrlAcceptsHttpAndRejectsUnsafeSchemes() {
        assertEquals(
            "https://example.com/post",
            com.selffeed.android.MainActivity.sanitizeAssistWebUrl("  https://example.com/post  "),
        )
        assertNull(com.selffeed.android.MainActivity.sanitizeAssistWebUrl("javascript:alert(1)"))
        assertNull(com.selffeed.android.MainActivity.sanitizeAssistWebUrl(""))
        assertNull(com.selffeed.android.MainActivity.sanitizeAssistWebUrl(null))
    }
}
