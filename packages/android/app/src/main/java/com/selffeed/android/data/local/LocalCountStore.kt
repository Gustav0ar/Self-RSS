package com.selffeed.android.data.local

import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.StatsResponse
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types

/** Captured before dispatch, then checked inside the transaction accepting a remote count snapshot. */
data class CountSnapshotTicket internal constructor(val readEpoch: Long, val hadPendingReads: Boolean)

@JsonClass(generateAdapter = true)
internal data class ReadCountScope(val feedId: String?, val categoryIds: Set<String>, val includeStats: Boolean)

/** Count updates share the caller's Room transaction with the corresponding outbox change. */
internal class LocalCountStore(private val dao: LocalStoreDao, moshi: Moshi) {
    private val scopeAdapter = moshi.adapter(ReadCountScope::class.java)
    private val statsAdapter = moshi.adapter(StatsResponse::class.java)
    private val childrenAdapter = moshi.adapter<List<CategoryWithCounts>>(
        Types.newParameterizedType(List::class.java, CategoryWithCounts::class.java),
    )

    suspend fun capture(): CountSnapshotTicket = CountSnapshotTicket(
        state().readEpoch,
        dao.hasPendingReadStateMutations(),
    )

    suspend fun mayAccept(ticket: CountSnapshotTicket): Boolean =
        !ticket.hadPendingReads && !dao.hasPendingReadStateMutations() && ticket.readEpoch == state().readEpoch

    /** Capture only the baselines this intent can adjust. Replacement and delivery keep this scope. */
    suspend fun captureReadScope(feedId: String?): String {
        val feed = feedId?.let { dao.readFeed(it) }
        val categoryIds = mutableSetOf<String>()
        fun findPath(category: CategoryWithCounts, ancestors: Set<String>) {
            val path = ancestors + category.id
            if (category.id == feed?.categoryId) categoryIds.addAll(path)
            category.children?.forEach { findPath(it, path) }
        }
        dao.readCategories().forEach { root ->
            if (root.id == feed?.categoryId) categoryIds.add(root.id)
            root.childrenJson?.let { runCatching { childrenAdapter.fromJson(it) }.getOrNull() }
                ?.forEach { findPath(it, setOf(root.id)) }
        }
        val current = state()
        return scopeAdapter.toJson(ReadCountScope(feed?.id, categoryIds, current.totalRead != null && current.totalUnread != null))
    }

    /** Keep signed totals internally: clamping each edit would make a rejected edit change the baseline. */
    suspend fun recordLocalReadChange(scopeJson: String?, before: Boolean?, after: Boolean?) {
        val scope = scopeJson?.let { runCatching { scopeAdapter.fromJson(it) }.getOrNull() }
        val delta = if (before == null || after == null || before == after) 0 else if (after) -1 else 1
        val current = state()
        dao.upsertCountState(current.copy(
            readEpoch = current.readEpoch + 1,
            totalRead = current.totalRead?.let { if (scope?.includeStats == true) it - delta else it },
            totalUnread = current.totalUnread?.let { if (scope?.includeStats == true) it + delta else it },
        ))
        if (delta == 0 || scope == null) return
        scope.feedId?.let { dao.applyFeedUnreadDelta(it, delta) }
        fun adjust(category: CategoryWithCounts): CategoryWithCounts = category.copy(
            unreadCount = category.unreadCount + if (category.id in scope.categoryIds) delta else 0,
            children = category.children?.map(::adjust),
        )
        val changed = dao.readCategories().mapNotNull { category ->
            val children = category.childrenJson?.let { runCatching { childrenAdapter.fromJson(it) }.getOrNull() }
            val adjusted = children?.map(::adjust)
            if (category.id !in scope.categoryIds && adjusted == children) null else category.copy(
                unreadCount = category.unreadCount + if (category.id in scope.categoryIds) delta else 0,
                childrenJson = adjusted?.let(childrenAdapter::toJson) ?: category.childrenJson,
            )
        }
        if (changed.isNotEmpty()) dao.upsertCategories(changed)
    }

    /** A deleted feed no longer contributes to any count baseline, even if delivery later fails. */
    suspend fun forgetFeedScope(feedId: String) {
        val retired = scopeAdapter.toJson(ReadCountScope(null, emptySet(), false))
        dao.readPendingReadStateMutations().forEach { mutation ->
            val scope = mutation.countScopeJson?.let { runCatching { scopeAdapter.fromJson(it) }.getOrNull() }
            if (scope?.feedId == feedId) {
                dao.upsertPendingReadStateMutation(mutation.copy(countScopeJson = retired))
            }
        }
    }

    /** Remote state is a freshness hint for totals; it is not another local count delta. */
    suspend fun invalidateCountSnapshot() {
        val current = state()
        dao.upsertCountState(current.copy(readEpoch = current.readEpoch + 1))
    }

    suspend fun writeStats(stats: StatsResponse, ticket: CountSnapshotTicket): StatsResponse? {
        val current = state()
        val accept = mayAccept(ticket)
        dao.upsertCountState(current.copy(
            statsJson = statsAdapter.toJson(stats),
            totalRead = if (accept) stats.totalRead else current.totalRead,
            totalUnread = if (accept) stats.totalUnread else current.totalUnread,
        ))
        return readStats()
    }

    suspend fun readStats(): StatsResponse? {
        val current = state()
        val read = current.totalRead ?: return null
        val unread = current.totalUnread ?: return null
        return current.statsJson?.let { json ->
            runCatching { statsAdapter.fromJson(json) }.getOrNull()?.copy(totalRead = read.coerceAtLeast(0), totalUnread = unread.coerceAtLeast(0))
        }
    }

    private suspend fun state(): LocalCountStateEntity = dao.readCountState() ?: LocalCountStateEntity()

}
