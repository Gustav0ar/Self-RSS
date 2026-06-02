package com.selffeed.android.ui.utils

import android.text.format.DateUtils
import java.time.Instant
import java.time.format.DateTimeParseException

fun formatPublishedAt(publishedAt: String?): String {
    if (publishedAt == null) return ""
    return try {
        val instant = Instant.parse(publishedAt)
        val timeMillis = instant.toEpochMilli()
        val now = System.currentTimeMillis()

        DateUtils.getRelativeTimeSpanString(
            timeMillis,
            now,
            DateUtils.MINUTE_IN_MILLIS,
            DateUtils.FORMAT_ABBREV_RELATIVE,
        ).toString()
    } catch (_: DateTimeParseException) {
        publishedAt
    }
}

fun formatSyncSummary(synced: Int?, failed: Int?): String = when {
    synced != null && failed != null && failed > 0 -> "$synced refreshed • $failed failed"
    synced != null -> "$synced feeds refreshed"
    else -> "Sync finished"
}
