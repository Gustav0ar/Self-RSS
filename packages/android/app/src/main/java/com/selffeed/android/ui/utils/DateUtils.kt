package com.selffeed.android.ui.utils

import android.text.format.DateUtils
import com.selffeed.android.R
import com.selffeed.android.ui.PresentationText
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

fun formatSyncSummary(synced: Int?, failed: Int?): PresentationText = when {
    synced != null && failed != null && failed > 0 -> PresentationText.joined(
        parts = listOf(
            PresentationText.plural(R.plurals.sync_refreshed_count, synced),
            PresentationText.plural(R.plurals.sync_failed_count, failed),
        ),
        separator = " • ",
    )
    synced != null -> PresentationText.plural(R.plurals.sync_feeds_refreshed_count, synced)
    else -> PresentationText.resource(R.string.sync_finished)
}
