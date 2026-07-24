package com.selffeed.android.ui

import com.selffeed.android.R
import com.selffeed.android.network.FeedWithCounts
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

data class FeedLifecyclePresentation(
    val title: PresentationText,
    val detail: PresentationText,
    val refreshBlocked: Boolean,
    val refreshGuidance: PresentationText? = null,
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
            title = PresentationText.resource(R.string.feed_lifecycle_validation_queued_title),
            detail = PresentationText.resource(R.string.feed_lifecycle_validation_queued_detail),
            refreshBlocked = true,
            refreshGuidance = PresentationText.resource(R.string.feed_lifecycle_validation_queued_guidance),
        )
        "replacement_pending" -> FeedLifecyclePresentation(
            title = PresentationText.resource(R.string.feed_lifecycle_replacement_title),
            detail = PresentationText.resource(R.string.feed_lifecycle_replacement_detail),
            refreshBlocked = true,
            refreshGuidance = PresentationText.resource(R.string.feed_lifecycle_replacement_guidance),
            canCancelReplacement = true,
        )
        "discovery_required" -> FeedLifecyclePresentation(
            title = PresentationText.resource(R.string.feed_lifecycle_discovery_title),
            detail = PresentationText.resource(R.string.feed_lifecycle_discovery_detail),
            refreshBlocked = true,
            refreshGuidance = PresentationText.resource(R.string.feed_lifecycle_discovery_guidance),
            discoveryRequired = true,
            canCancelReplacement = feed.sourceId != null && feed.pendingSourceId != null,
        )
        "backoff" -> FeedLifecyclePresentation(
            title = PresentationText.resource(R.string.feed_lifecycle_backoff_title),
            detail = if (waiting) {
                PresentationText.resource(
                    R.string.feed_lifecycle_backoff_waiting_detail,
                    nextEligibleLabel.orEmpty(),
                )
            } else {
                PresentationText.resource(R.string.feed_lifecycle_backoff_ready_detail)
            },
            refreshBlocked = waiting,
            refreshGuidance = if (waiting) {
                PresentationText.resource(
                    R.string.feed_lifecycle_available_after,
                    nextEligibleLabel.orEmpty(),
                )
            } else {
                null
            },
            canCancelReplacement = feed.pendingSourceId != null,
        )
        "paused" -> FeedLifecyclePresentation(
            title = PresentationText.resource(R.string.feed_lifecycle_paused_title),
            detail = sourceDetail?.let {
                PresentationText.resource(R.string.feed_lifecycle_paused_source_detail, it)
            } ?: PresentationText.resource(R.string.feed_lifecycle_paused_detail),
            refreshBlocked = true,
            refreshGuidance = PresentationText.resource(R.string.feed_lifecycle_paused_guidance),
            canCancelReplacement = feed.pendingSourceId != null,
        )
        "error" -> FeedLifecyclePresentation(
            title = PresentationText.resource(R.string.feed_lifecycle_error_title),
            detail = sourceDetail?.let(PresentationText::dynamic)
                ?: PresentationText.resource(R.string.feed_lifecycle_error_detail),
            refreshBlocked = waiting,
            refreshGuidance = if (waiting) {
                PresentationText.resource(
                    R.string.feed_lifecycle_available_after,
                    nextEligibleLabel.orEmpty(),
                )
            } else {
                null
            },
            canCancelReplacement = feed.pendingSourceId != null,
        )
        "active", "idle" -> null
        else -> null
    }
}
