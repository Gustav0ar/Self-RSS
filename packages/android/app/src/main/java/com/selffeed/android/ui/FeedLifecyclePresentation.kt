package com.selffeed.android.ui

import com.selffeed.android.network.FeedWithCounts
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

data class FeedLifecyclePresentation(
    val title: String,
    val detail: String,
    val refreshBlocked: Boolean,
    val refreshGuidance: String? = null,
    val discoveryRequired: Boolean = false,
    val canCancelReplacement: Boolean = false,
)

fun feedLifecyclePresentation(feed: FeedWithCounts, nowEpochMillis: Long = System.currentTimeMillis()): FeedLifecyclePresentation? {
    val lifecycle = feed.lifecycleStatus ?: feed.syncStatus
    val nextEligible = feed.nextEligibleFetchAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    val waiting = nextEligible != null && nextEligible > nowEpochMillis
    val nextEligibleLabel = nextEligible?.let {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT)
            .withZone(ZoneId.systemDefault())
            .format(Instant.ofEpochMilli(it))
    }
    val sourceDetail = feed.sourceErrorDetails?.takeIf(String::isNotBlank)
        ?: feed.lastSyncError?.takeIf(String::isNotBlank)
    return when (lifecycle) {
        "pending" -> FeedLifecyclePresentation(
            title = "Validation queued",
            detail = "Articles will appear after the first successful fetch.",
            refreshBlocked = true,
            refreshGuidance = "Validation is already queued.",
        )
        "replacement_pending" -> FeedLifecyclePresentation(
            title = "Replacement validating",
            detail = "Existing articles remain available until the new source succeeds.",
            refreshBlocked = true,
            refreshGuidance = "Replacement validation is already queued.",
            canCancelReplacement = true,
        )
        "discovery_required" -> FeedLifecyclePresentation(
            title = "Choose a feed",
            detail = "This website needs an explicit feed choice. SelfFeed will not repeatedly fetch it.",
            refreshBlocked = true,
            refreshGuidance = "Choose a discovered feed before refreshing.",
            discoveryRequired = true,
            canCancelReplacement = feed.sourceId != null && feed.pendingSourceId != null,
        )
        "backoff" -> FeedLifecyclePresentation(
            title = "Publisher cooldown",
            detail = if (waiting) {
                "The publisher can be checked again after $nextEligibleLabel. Existing articles remain available."
            } else "The publisher can be checked again safely.",
            refreshBlocked = waiting,
            refreshGuidance = if (waiting) "Available after $nextEligibleLabel." else null,
            canCancelReplacement = feed.pendingSourceId != null,
        )
        "paused" -> FeedLifecyclePresentation(
            title = "Feed needs attention",
            detail = sourceDetail?.let { "$it Review the source URL to resume safely." }
                ?: "Automatic fetching paused after repeated or permanent failures. Review the source URL.",
            refreshBlocked = true,
            refreshGuidance = "Edit the feed URL to resume validation safely.",
            canCancelReplacement = feed.pendingSourceId != null,
        )
        "error" -> FeedLifecyclePresentation(
            title = "Latest refresh failed",
            detail = sourceDetail ?: "The publisher could not be reached during the latest attempt.",
            refreshBlocked = waiting,
            refreshGuidance = if (waiting) "Available after $nextEligibleLabel." else null,
            canCancelReplacement = feed.pendingSourceId != null,
        )
        "active", "idle" -> null
        else -> null
    }
}
