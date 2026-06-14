package com.selffeed.android.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap

internal class MemoryCache(
    private val maxEntries: Int,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private val entries = ConcurrentHashMap<String, Entry<Any?>>()
    private val locks = ConcurrentHashMap<String, Mutex>()

    val size: Int
        get() = entries.size

    suspend fun <T> getOrLoad(
        key: String,
        ttlMs: Long,
        onHit: () -> Unit = {},
        onMiss: () -> Unit = {},
        onStore: () -> Unit = {},
        loader: suspend () -> T,
    ): T {
        get<T>(key)?.let {
            onHit()
            return it
        }

        onMiss()
        val mutex = locks.getOrPut(key) { Mutex() }
        return mutex.withLock {
            get<T>(key)?.let {
                onHit()
                return@withLock it
            }

            val loaded = loader()
            put(key, ttlMs, loaded)
            onStore()
            loaded
        }
    }

    @Suppress("UNCHECKED_CAST")
    fun <T> get(key: String): T? {
        val entry = entries[key] ?: return null
        val now = nowMs()
        if (entry.expiresAtMs < now) {
            entries.remove(key)
            locks.remove(key)
            return null
        }
        entry.lastAccessMs = now
        return entry.value as? T
    }

    fun put(key: String, ttlMs: Long, value: Any?) {
        val now = nowMs()
        entries[key] = Entry(
            value = value,
            expiresAtMs = now + ttlMs,
            lastAccessMs = now,
        )
        prune()
    }

    fun invalidateByPrefix(prefix: String): Int {
        var removed = 0
        entries.keys.removeIf { key ->
            val shouldRemove =
                if (prefix.endsWith(':')) {
                    key == prefix.dropLast(1) || key.startsWith(prefix)
                } else {
                    key == prefix || key.startsWith("$prefix:")
                }
            if (shouldRemove) {
                removed++
                locks.remove(key)
            }
            shouldRemove
        }
        return removed
    }

    fun clear(): Int {
        val cleared = entries.size
        entries.clear()
        locks.clear()
        return cleared
    }

    private fun prune() {
        val now = nowMs()
        val expiredKeys = entries.entries
            .filter { (_, entry) -> entry.expiresAtMs < now }
            .map { it.key }
        expiredKeys.forEach { key ->
            entries.remove(key)
            locks.remove(key)
        }

        if (entries.size <= maxEntries) return

        val overflow = entries.size - maxEntries
        entries.entries
            .sortedBy { it.value.lastAccessMs }
            .take(overflow)
            .forEach { (key, _) ->
                entries.remove(key)
                locks.remove(key)
            }
    }

    private data class Entry<T>(
        val value: T,
        val expiresAtMs: Long,
        var lastAccessMs: Long,
    )
}
