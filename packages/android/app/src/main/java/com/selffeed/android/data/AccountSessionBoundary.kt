package com.selffeed.android.data

import com.selffeed.android.data.local.LocalOwnerEntity
import com.selffeed.android.data.local.LocalStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * Serializes local commits with account replacement. Network work runs outside
 * the commit mutex, in a child scope cancelled when its durable owner changes.
 */
internal class AccountSessionBoundary(
    private val sessionStore: SessionStore,
    private val localStore: LocalStore,
    private val onReplaced: () -> Unit,
) {
    private val commits = Mutex()
    private val calls = mutableSetOf<Job>()
    @Volatile private var preparedOwner: ApiSession? = null

    suspend fun prepare(): ApiSession = commits.withLock {
        sessionStore.preload()
        reconcileLocked()
    }

    suspend fun <T> withSession(
        expected: ApiSession? = sessionStore.loadedSession(),
        block: suspend (ApiSession) -> T,
    ): T = coroutineScope {
        val job = currentCoroutineContext().job
        val owner = commits.withLock {
            sessionStore.preload()
            expected?.let(::requireCurrent)
            reconcileLocked().also { synchronized(calls) { calls.add(job) } }
        }
        job.invokeOnCompletion { synchronized(calls) { calls.remove(job) } }
        currentCoroutineContext().ensureActive()
        block(owner).also { requireCurrent(owner) }
    }

    suspend fun <T> commit(owner: ApiSession, block: suspend () -> T): T = commits.withLock {
        currentCoroutineContext().ensureActive()
        requireCurrent(owner)
        check(preparedOwner == owner) { "Account storage has not been prepared" }
        block()
    }

    /** Only local SessionStore mutations belong here. Never pass network work. */
    suspend fun <T> replace(block: suspend () -> T): T = commits.withLock {
        currentCoroutineContext().ensureActive()
        // Once replacement starts, complete the short two-store handoff even if
        // its UI caller disappears. A process crash is repaired by prepare().
        withContext(NonCancellable) {
            sessionStore.preload()
            reconcileLocked()
            try { block() } finally { reconcileLocked() }
        }
    }

    suspend fun clearIfCurrent(owner: ApiSession): ApiSession? = commits.withLock {
        if (!sessionStore.isCurrentSession(owner)) return@withLock null
        withContext(NonCancellable) {
            reconcileLocked()
            sessionStore.clear()
            reconcileLocked()
        }
    }

    fun <T> readCurrentMemory(block: () -> T?): T? {
        val owner = preparedOwner ?: return null
        if (!sessionStore.isCurrentSession(owner)) return null
        val value = block()
        return value.takeIf { sessionStore.isCurrentSession(owner) }
    }

    fun requireCurrent(owner: ApiSession) {
        if (!sessionStore.isCurrentSession(owner)) throw SessionChangedException()
    }

    private suspend fun reconcileLocked(): ApiSession {
        val owner = sessionStore.currentSession()
        if (preparedOwner == owner) return owner
        val replaced = localStore.switchOwner(LocalOwnerEntity(ownerId = owner.ownerId, apiBaseUrl = owner.apiBaseUrl))
        if (replaced || (preparedOwner != null && preparedOwner != owner)) {
            val oldCalls = synchronized(calls) { calls.toList().also { calls.clear() } }
            oldCalls.forEach { it.cancel(SessionChangedException()) }
            onReplaced()
        }
        preparedOwner = owner
        return owner
    }
}

internal class SessionChangedException : CancellationException("Account session changed")
