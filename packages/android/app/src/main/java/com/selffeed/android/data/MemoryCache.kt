package com.selffeed.android.data

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class MemoryCache(
    private val maxEntries: Int,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private val monitor = Any()
    private val entries = LinkedHashMap<String, Entry>(16, 0.75f, true)
    private val loads = mutableMapOf<String, Load>()
    private var activeLoads = 0

    init { require(maxEntries >= 0) }

    val size: Int get() = synchronized(monitor) { entries.size }
    /** Registered keys can be forgotten while their invalidated callers still finish. */
    val loadKeyCount: Int get() = synchronized(monitor) { loads.size }
    val activeLoadCount: Int get() = synchronized(monitor) { activeLoads }

    @Suppress("UNCHECKED_CAST")
    suspend fun <T> getOrLoad(
        key: String,
        ttlMs: Long,
        onHit: () -> Unit = {},
        onMiss: () -> Unit = {},
        onStore: () -> Unit = {},
        loader: suspend () -> T,
    ): T {
        val load = when (val lookup = synchronized(monitor) {
            getEntry(key) ?: loads.getOrPut(key, ::Load).also { it.users++; activeLoads++ }
        }) {
            is Entry -> {
                onHit()
                return lookup.value as T
            }
            is Load -> lookup
        }
        try {
            onMiss()
            return load.mutex.withLock {
                // A waiter admitted before invalidation must not consume a replacement
                // account's value. It can finish its own request but cannot cache it.
                val cached = synchronized(monitor) { if (load.valid) getEntry(key) else null }
                if (cached != null) {
                    onHit()
                    return@withLock cached.value as T
                }
                val value = loader()
                currentCoroutineContext().ensureActive()
                val stored = synchronized(monitor) {
                    if (load.valid) {
                        putEntry(key, ttlMs, value)
                        true
                    } else false
                }
                if (stored) onStore()
                value
            }
        } finally {
            synchronized(monitor) {
                load.users--
                activeLoads--
                if (load.users == 0 && loads[key] === load) loads.remove(key)
            }
        }
    }

    @Suppress("UNCHECKED_CAST")
    fun <T> get(key: String): T? = synchronized(monitor) { getEntry(key)?.value as? T }

    fun put(key: String, ttlMs: Long, value: Any?) = synchronized(monitor) {
        // An explicit write is newer than a load that started before it.
        loads.remove(key)?.valid = false
        putEntry(key, ttlMs, value)
    }

    fun invalidateByPrefix(prefix: String): Int = synchronized(monitor) {
        val namespace = prefix.removeSuffix(":")
        fun matches(key: String) = key == namespace || key.startsWith("$namespace:")
        val before = entries.size
        entries.keys.removeAll(::matches)
        val iterator = loads.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (matches(entry.key)) {
                entry.value.valid = false
                iterator.remove()
            }
        }
        before - entries.size
    }

    fun clear(): Int = synchronized(monitor) {
        val cleared = entries.size
        entries.clear()
        loads.values.forEach { it.valid = false }
        loads.clear()
        cleared
    }

    /** Only called with monitor held; no loader or callback runs under this lock. */
    private fun getEntry(key: String): Entry? {
        val entry = entries[key] ?: return null
        if (entry.expiresAtMs < nowMs()) {
            entries.remove(key)
            return null
        }
        return entry
    }

    private fun putEntry(key: String, ttlMs: Long, value: Any?) {
        val now = nowMs()
        entries[key] = Entry(value, now + ttlMs)
        entries.values.removeAll { it.expiresAtMs < now }
        val oldest = entries.entries.iterator()
        while (entries.size > maxEntries && oldest.hasNext()) {
            oldest.next()
            oldest.remove()
        }
    }

    private sealed interface Lookup

    private class Load : Lookup {
        val mutex = Mutex()
        var users = 0
        var valid = true
    }

    private data class Entry(val value: Any?, val expiresAtMs: Long) : Lookup
}
