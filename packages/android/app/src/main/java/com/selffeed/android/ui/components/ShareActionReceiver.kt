package com.selffeed.android.ui.components

import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.widget.Toast
import com.selffeed.android.R

/**
 * Handles private Android 14+ ShareSheet custom actions dispatched from [shareArticle].
 *
 * Kept non-exported in `AndroidManifest.xml` so only PendingIntents created by SelfFeed
 * can invoke it.
 */
class ShareActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_COPY_ARTICLE_LINK) return
        val url = intent.getStringExtra(EXTRA_ARTICLE_URL)
            ?.takeIf { it.startsWith("http://", ignoreCase = true) || it.startsWith("https://", ignoreCase = true) }
            ?: return
        val title = intent.getStringExtra(EXTRA_ARTICLE_TITLE).orEmpty()
            .ifBlank { context.getString(R.string.app_name) }
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
        clipboard.setPrimaryClip(ClipData.newPlainText(title, url))
        // Android 13+ displays a built-in clipboard confirmation overlay.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            Toast.makeText(context, R.string.share_link_copied, Toast.LENGTH_SHORT).show()
        }
    }

    companion object {
        const val ACTION_COPY_ARTICLE_LINK = "com.selffeed.android.action.COPY_ARTICLE_LINK"
        const val EXTRA_ARTICLE_URL = "extra_article_url"
        const val EXTRA_ARTICLE_TITLE = "extra_article_title"
    }
}
