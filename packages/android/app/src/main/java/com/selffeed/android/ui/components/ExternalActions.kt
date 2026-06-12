package com.selffeed.android.ui.components

import android.content.Context
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

private val opmlCleanupScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

fun shareOpmlContent(context: Context, content: String) {
    // Place exports in the FileProvider-allowlisted "shared/" subdirectory of
    // cacheDir. The new file_paths.xml restricts the FileProvider to that
    // path, so we must write the file there. A randomized suffix prevents
    // collisions between successive exports.
    val sharedDir = File(context.cacheDir, "shared").apply { mkdirs() }
    val opmlFile = File(sharedDir, "rss-feeds-${System.currentTimeMillis()}.opml").apply {
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
    val chooser = Intent.createChooser(shareIntent, "Share OPML")
    context.startActivity(chooser)

    // The Android docs guarantee `deleteOnExit` only fires on JVM shutdown,
    // which essentially never happens on Android. Replace it with a deferred
    // delete after the receiving app has had time to read the file. The file
    // is also reaped on the next app start (we delete any stale files older
    // than 1 hour from the shared dir).
    opmlCleanupScope.launch {
        delay(OPML_SHARE_DELETE_DELAY_MS)
        runCatching { opmlFile.delete() }
    }
}

/**
 * Reap orphaned OPML exports from the shared cache directory. Intended to
 * be called once at app start to keep the cache from accumulating.
 */
fun reapStaleOpmlExports(context: Context) {
    val sharedDir = File(context.cacheDir, "shared")
    if (!sharedDir.isDirectory) return
    val cutoff = System.currentTimeMillis() - OPML_REAP_MAX_AGE_MS
    sharedDir.listFiles()?.forEach { file ->
        if (file.isFile && file.lastModified() < cutoff) {
            file.delete()
        }
    }
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

private const val OPML_SHARE_DELETE_DELAY_MS = 5 * 60_000L // 5 minutes
private const val OPML_REAP_MAX_AGE_MS = 60 * 60_000L // 1 hour
