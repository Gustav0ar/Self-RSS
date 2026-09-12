package com.selffeed.android.ui.components

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlin.coroutines.CoroutineContext

/** Holds actual preparation dispatch, without blocking Main or creating a test worker thread. */
internal class ReaderPreparationGate : CoroutineDispatcher() {
    private val lock = Any()
    private var paused = false
    private var outstanding = 0
    private val pending = mutableListOf<Pair<CoroutineContext, Runnable>>()
    val pendingCount: Int get() = synchronized(lock) { pending.size }
    val isIdle: Boolean get() = synchronized(lock) { outstanding == 0 }
    fun pause() { synchronized(lock) { paused = true } }
    override fun dispatch(context: CoroutineContext, block: Runnable) {
        val tracked = Runnable {
            try { block.run() } finally { synchronized(lock) { outstanding-- } }
        }
        val queued = synchronized(lock) {
            outstanding++
            if (paused) { pending += context to tracked; true } else false
        }
        if (!queued) Dispatchers.Default.dispatch(context, tracked)
    }
    fun release() {
        val work = synchronized(lock) {
            paused = false
            pending.toList().also { pending.clear() }
        }
        work.forEach { (context, block) -> Dispatchers.Default.dispatch(context, block) }
    }
}
