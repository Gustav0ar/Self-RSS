package com.selffeed.android.data.local

/** A legacy record may know a revision before its confirmed value has been recovered. */
internal data class ConfirmedArticleState(val value: Boolean?, val revision: Int?) {
    fun merge(incoming: Boolean, incomingRevision: Int?): ConfirmedArticleState = when {
        revision == null -> ConfirmedArticleState(incoming, incomingRevision)
        incomingRevision == null || incomingRevision < revision -> this
        incomingRevision == revision && value != null -> this
        else -> ConfirmedArticleState(incoming, incomingRevision)
    }
}

/** A matching rejected delivery identifies the original local choice even after transport retries. */
data class RejectedArticleMutation(val mutationId: String, val effectiveState: Boolean?)

/** Removing an outbox entry and learning server state are independent facts. */
data class ArticleStateMutationResult(
    val removedMatchingIntent: Boolean,
    val effectiveState: Boolean?,
)
