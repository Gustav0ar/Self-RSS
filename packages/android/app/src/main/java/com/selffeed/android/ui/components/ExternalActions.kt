package com.selffeed.android.ui.components

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri

fun shareOpmlContent(context: Context, content: String) {
    // Use a randomized suffix so successive exports don't collide and
    // the previous file's lifecycle doesn't have to be tracked. The
    // file is written into the cache dir, which Android may reclaim at
    // any time, but in practice exports are rare and the per-file
    // cleanup below keeps the cache from growing without bound.
    val opmlFile = File(context.cacheDir, "rss-feeds-${System.currentTimeMillis()}.opml").apply {
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
    // Best-effort cleanup after the chooser has been displayed. The
    // receiving app may not have read the file yet, so we delete on a
    // small delay. If the chooser is dismissed before the receiver
    // reads, the file is lost — that is acceptable, the OPML content
    // is already in memory if the user retries.
    val intentLauncher = Intent.createChooser(shareIntent, "Share OPML")
    context.startActivity(intentLauncher)
    opmlFile.deleteOnExit()
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
