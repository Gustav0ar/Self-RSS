package com.selffeed.android.ui.components

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri

fun shareOpmlContent(context: Context, content: String) {
    val opmlFile = File(context.cacheDir, "rss-feeds.opml").apply {
        writeText(content)
    }
    val uri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.provider",
        opmlFile,
    )

    val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "application/xml"
        putExtra(Intent.EXTRA_SUBJECT, "rss-feeds.opml")
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(shareIntent, "Share OPML"))
}

fun openExternalUrl(context: Context, url: String?) {
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
    }
}
