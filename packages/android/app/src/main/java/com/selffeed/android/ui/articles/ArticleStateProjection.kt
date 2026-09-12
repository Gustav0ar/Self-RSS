package com.selffeed.android.ui.articles

import com.selffeed.android.data.repository.ArticleMutationReceipt
import com.selffeed.android.data.repository.LocalArticleState
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Main-thread presentation state. Room owns settled values; only unfinished user choices override it. */
internal class ArticleStateProjection {
    enum class Field { Read, Saved }
    class Action internal constructor(val articleId: String, val field: Field, val value: Boolean) {
        internal var receiptId: String? = null
    }
    private var retainedIds: Set<String> = emptySet()
    private var stored: Map<String, LocalArticleState> = emptyMap()
    // Display-only rollback for legacy/unknown stored fields. Never used as a mutation base.
    private var fallbacks: Map<String, ArticleFlags> = emptyMap()
    private val actions = mutableMapOf<Pair<String, Field>, Action>()
    class Observation internal constructor(val articleIds: Set<String>)
    private val _observation = MutableStateFlow(Observation(emptySet()))
    val observation = _observation.asStateFlow()
    private val _flags = MutableStateFlow<Map<String, ArticleFlags>>(emptyMap())
    val flags = _flags.asStateFlow()

    fun retain(articleIds: Set<String>) {
        retainedIds = articleIds.toSet()
        actions.entries.removeAll { (_, action) -> action.receiptId != null && action.articleId !in retainedIds }
        publish()
    }

    fun begin(articleId: String, field: Field, value: Boolean, previousValue: Boolean? = null): Action {
        val action = Action(articleId, field, value)
        val prior = fallbacks[articleId] ?: ArticleFlags()
        val local = stored[articleId]
        val confirmed = if (actions[articleId to field] == null) when (field) {
            Field.Read -> local?.isRead?.takeIf { local.pendingReadMutationId == null }
            Field.Saved -> local?.isSaved?.takeIf { local.pendingSavedMutationId == null }
        } else null
        fallbacks = fallbacks + (articleId to when (field) {
            Field.Read -> prior.copy(isRead = confirmed ?: prior.isRead ?: previousValue)
            Field.Saved -> prior.copy(isSaved = confirmed ?: prior.isSaved ?: previousValue)
        })
        actions[articleId to field] = action
        publish()
        return action
    }

    fun committed(action: Action, receipt: ArticleMutationReceipt) {
        if (actions[action.articleId to action.field] !== action) return
        action.receiptId = receipt.mutationId
        if (action.articleId !in retainedIds || stored[action.articleId].acknowledges(action)) {
            actions.remove(action.articleId to action.field)
        }
        publish()
    }

    fun failed(action: Action) {
        if (actions[action.articleId to action.field] !== action) return
        actions.remove(action.articleId to action.field)
        publish()
    }

    /** A cancelled window cannot publish into a later window, even if its producer ignores cancellation. */
    fun accept(request: Observation, states: Map<String, LocalArticleState>) {
        if (request !== _observation.value) return
        stored = states.filterKeys { it in request.articleIds }
        actions.entries.removeAll { (_, action) -> stored[action.articleId].acknowledges(action) }
        publish()
    }

    fun clear() {
        retainedIds = emptySet()
        actions.clear()
        stored = emptyMap()
        fallbacks = emptyMap()
        publish(forceNewObservation = true)
    }

    /** Retires callbacks across STOP/START even when the requested IDs are unchanged. */
    fun restartObservation() { _observation.value = Observation(_observation.value.articleIds) }

    private fun LocalArticleState?.acknowledges(action: Action): Boolean {
        val receipt = action.receiptId ?: return false
        return when (action.field) {
            Field.Read -> this?.lastReadMutationId == receipt
            Field.Saved -> this?.lastSavedMutationId == receipt
        }
    }

    private fun publish(forceNewObservation: Boolean = false) {
        val ids = retainedIds + actions.values.map { it.articleId }
        stored = stored.filterKeys { it in ids }
        fallbacks = fallbacks.filterKeys { it in ids }
        if (forceNewObservation || ids != _observation.value.articleIds) _observation.value = Observation(ids)
        _flags.value = buildMap {
            putAll(fallbacks)
            stored.forEach { (id, state) ->
                val fallback = get(id)
                put(id, ArticleFlags(state.isRead ?: fallback?.isRead, state.isSaved ?: fallback?.isSaved))
            }
            actions.values.forEach { action ->
                val current = get(action.articleId) ?: ArticleFlags()
                put(action.articleId, when (action.field) {
                    Field.Read -> current.copy(isRead = action.value)
                    Field.Saved -> current.copy(isSaved = action.value)
                })
            }
        }
    }
}

data class ArticleFlags(val isRead: Boolean? = null, val isSaved: Boolean? = null)

internal fun ArticleListItem.withArticleFlags(flags: ArticleFlags?): ArticleListItem =
    if (flags == null) this else copy(isRead = flags.isRead ?: isRead, isSaved = flags.isSaved ?: isSaved)

internal fun ArticleDetail.withArticleFlags(flags: ArticleFlags?): ArticleDetail =
    if (flags == null) this else copy(isRead = flags.isRead ?: isRead, isSaved = flags.isSaved ?: isSaved)
