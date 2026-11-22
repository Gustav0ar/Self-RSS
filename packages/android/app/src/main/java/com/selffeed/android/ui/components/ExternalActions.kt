package com.selffeed.android.ui.components

import android.app.PendingIntent
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.service.chooser.ChooserAction
import androidx.annotation.RequiresApi
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsServiceConnection
import androidx.browser.customtabs.CustomTabsSession
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.net.toUri
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.selffeed.android.R

internal val LocalCustomTabsPrewarmer = staticCompositionLocalOf<CustomTabsPrewarmer?> { null }

/**
 * Lifecycle-bound Chrome Custom Tabs prewarmer.
 *
 * Binds to the device's Custom Tabs provider while the Activity is foregrounded,
 * warms up the browser process once, and hints upcoming article URLs via
 * `mayLaunchUrl` so tapping "Open original" skips DNS/TLS cold start.
 */
class CustomTabsPrewarmer(
    context: Context,
) : DefaultLifecycleObserver {
    private val appContext = context.applicationContext
    private var bound = false
    private var client: CustomTabsClient? = null
    @Volatile
    var session: CustomTabsSession? = null
        private set
    private var pendingUrl: String? = null
    private var lastHintedUrl: String? = null

    private val connection = object : CustomTabsServiceConnection() {
        override fun onCustomTabsServiceConnected(name: ComponentName, customTabsClient: CustomTabsClient) {
            client = customTabsClient
            runCatching { customTabsClient.warmup(0L) }
            val created = runCatching { customTabsClient.newSession(null) }.getOrNull()
            session = created
            val url = pendingUrl
            if (created != null && url != null && url != lastHintedUrl) {
                lastHintedUrl = url
                runCatching { created.mayLaunchUrl(url.toUri(), null, null) }
            }
        }

        override fun onServiceDisconnected(name: ComponentName) {
            client = null
            session = null
            lastHintedUrl = null
        }
    }

    override fun onStart(owner: LifecycleOwner) {
        if (bound) return
        val packageName = runCatching {
            CustomTabsClient.getPackageName(appContext, null)
        }.getOrNull() ?: return
        bound = runCatching {
            CustomTabsClient.bindCustomTabsService(appContext, packageName, connection)
        }.getOrDefault(false)
    }

    override fun onStop(owner: LifecycleOwner) {
        if (!bound) return
        runCatching { appContext.unbindService(connection) }
        bound = false
        client = null
        session = null
        lastHintedUrl = null
    }

    fun mayLaunchUrl(url: String?) {
        val safeUrl = url?.takeIf { it.startsWith("http://") || it.startsWith("https://") } ?: return
        pendingUrl = safeUrl
        val activeSession = session ?: return
        if (safeUrl == lastHintedUrl) return
        lastHintedUrl = safeUrl
        runCatching { activeSession.mayLaunchUrl(safeUrl.toUri(), null, null) }
    }
}

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
    val chooser = buildShareArticleChooserIntent(context, title, url) ?: return
    context.startActivity(chooser)
}

internal fun buildShareArticleChooserIntent(
    context: Context,
    title: String,
    url: String?,
): Intent? {
    val safeUrl = url?.takeIf { it.startsWith("http://") || it.startsWith("https://") } ?: return null
    val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TITLE, title)
        putExtra(Intent.EXTRA_SUBJECT, title)
        putExtra(Intent.EXTRA_TEXT, "$title\n$safeUrl")
        clipData = ClipData.newPlainText(title, safeUrl)
    }
    return Intent.createChooser(shareIntent, context.getString(R.string.share_article_chooser)).apply {
        putExtra(Intent.EXTRA_TITLE, title)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            putExtra(
                Intent.EXTRA_CHOOSER_CUSTOM_ACTIONS,
                buildArticleShareChooserActions(context, title, safeUrl),
            )
        }
    }
}

@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
private fun buildArticleShareChooserActions(
    context: Context,
    title: String,
    safeUrl: String,
): Array<ChooserAction> {
    val requestCode = safeUrl.hashCode() and 0x7FFFFFFF
    val copyIntent = Intent(context, ShareActionReceiver::class.java).apply {
        action = ShareActionReceiver.ACTION_COPY_ARTICLE_LINK
        putExtra(ShareActionReceiver.EXTRA_ARTICLE_URL, safeUrl)
        putExtra(ShareActionReceiver.EXTRA_ARTICLE_TITLE, title)
    }
    val copyPendingIntent = PendingIntent.getBroadcast(
        context,
        requestCode,
        copyIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val openIntent = Intent(Intent.ACTION_VIEW, safeUrl.toUri())
    val openPendingIntent = PendingIntent.getActivity(
        context,
        requestCode xor 0x1,
        openIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return arrayOf(
        ChooserAction.Builder(
            Icon.createWithResource(context, R.drawable.ic_share_copy_link),
            context.getString(R.string.share_action_copy_link),
            copyPendingIntent,
        ).build(),
        ChooserAction.Builder(
            Icon.createWithResource(context, R.drawable.ic_share_open_browser),
            context.getString(R.string.share_action_open_browser),
            openPendingIntent,
        ).build(),
    )
}

fun openExternalUrl(
    context: Context,
    url: String?,
    session: CustomTabsSession? = null,
    onCustomTabClosed: (() -> Unit)? = null,
) {
    val safeUrl = url?.takeIf { it.startsWith("http://") || it.startsWith("https://") } ?: return
    try {
        val builder = if (session != null) {
            CustomTabsIntent.Builder(session)
        } else {
            CustomTabsIntent.Builder()
        }
        val customTabsIntent = builder
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
