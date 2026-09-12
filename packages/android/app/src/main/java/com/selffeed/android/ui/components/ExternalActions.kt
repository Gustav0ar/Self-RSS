package com.selffeed.android.ui.components

import android.content.Context
import android.content.Intent
import android.content.ClipData
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri
import com.selffeed.android.R
fun shareOpmlFile(context: Context, uri: Uri) {
    val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "application/xml"
        putExtra(Intent.EXTRA_SUBJECT, "rss-feeds.opml")
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri("rss-feeds.opml", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    val chooser = Intent.createChooser(shareIntent, context.getString(R.string.share_opml_chooser))
    context.startActivity(chooser)
}

fun shareArticle(context: Context, title: String, url: String?) {
    val safeUrl = url?.takeIf { it.startsWith("http://") || it.startsWith("https://") } ?: return
    val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TITLE, title)
        putExtra(Intent.EXTRA_SUBJECT, title)
        putExtra(Intent.EXTRA_TEXT, "$title\n$safeUrl")
    }
    context.startActivity(
        Intent.createChooser(shareIntent, context.getString(R.string.share_article_chooser)),
    )
}

fun openExternalUrl(context: Context, url: String?, onCustomTabClosed: (() -> Unit)? = null) {
    val safeUrl = url?.takeIf { it.startsWith("http://") || it.startsWith("https://") } ?: return
    try {
        val customTabsIntent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
        customTabsIntent.launchUrl(context, safeUrl.toUri())
    } catch (_: Exception) {
        // Fallback to regular browser if Custom Tabs fails
        val intent = Intent(Intent.ACTION_VIEW, safeUrl.toUri())
        context.startActivity(intent)
        // Browser doesn't notify us, but we can still signal the callback
        onCustomTabClosed?.invoke()
    }
}
