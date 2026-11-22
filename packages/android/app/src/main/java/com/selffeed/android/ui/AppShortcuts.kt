package com.selffeed.android.ui

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.net.toUri
import com.selffeed.android.MainActivity
import com.selffeed.android.R

/**
 * Publishes dynamic launcher shortcuts (Unread, Saved, Search) using
 * [ShortcutManagerCompat] so they work across all build variants and
 * applicationId suffixes without hardcoded package names.
 */
object AppShortcuts {
    fun publish(context: Context) {
        val appContext = context.applicationContext
        val unreadIcon = IconCompat.createWithResource(appContext, R.drawable.ic_shortcut_unread)
        val savedIcon = IconCompat.createWithResource(appContext, R.drawable.ic_shortcut_saved)
        val searchIcon = IconCompat.createWithResource(appContext, R.drawable.ic_shortcut_search)
        val shortcuts = listOf(
            buildShortcut(
                context = appContext,
                id = ShortcutDestination.UNREAD.shortcutId,
                shortLabel = appContext.getString(R.string.shortcut_unread_short),
                longLabel = appContext.getString(R.string.shortcut_unread_long),
                uri = "selffeed://unread",
                icon = unreadIcon,
                rank = 0,
            ),
            buildShortcut(
                context = appContext,
                id = ShortcutDestination.SAVED.shortcutId,
                shortLabel = appContext.getString(R.string.shortcut_saved_short),
                longLabel = appContext.getString(R.string.shortcut_saved_long),
                uri = "selffeed://saved",
                icon = savedIcon,
                rank = 1,
            ),
            buildShortcut(
                context = appContext,
                id = ShortcutDestination.SEARCH.shortcutId,
                shortLabel = appContext.getString(R.string.shortcut_search_short),
                longLabel = appContext.getString(R.string.shortcut_search_long),
                uri = "selffeed://search",
                icon = searchIcon,
                rank = 2,
            ),
        )
        runCatching { ShortcutManagerCompat.setDynamicShortcuts(appContext, shortcuts) }
    }

    private fun buildShortcut(
        context: Context,
        id: String,
        shortLabel: String,
        longLabel: String,
        uri: String,
        icon: IconCompat,
        rank: Int,
    ): ShortcutInfoCompat = ShortcutInfoCompat.Builder(context, id)
        .setShortLabel(shortLabel)
        .setLongLabel(longLabel)
        .setIcon(icon)
        .setRank(rank)
        .setIntent(
            Intent(Intent.ACTION_VIEW, uri.toUri(), context, MainActivity::class.java),
        )
        .build()
}
