package com.selffeed.android.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Pure unit tests for the [NetworkMonitor] interface contract. We test against
 * a tiny in-memory implementation that mirrors the
 * [AndroidNetworkMonitor.hasBeenOnline] behavior (flag latches true on the
 * first `online == true` observation).
 */
class NetworkMonitorTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

    @After
    fun teardown() {
        scope.cancel()
    }

    @Test
    fun `initial online state is exposed`() {
        val monitor = FakeNetworkMonitor(scope = scope, online = true)
        assertTrue(monitor.online.value)
    }

    @Test
    fun `initial offline state is exposed`() {
        val monitor = FakeNetworkMonitor(scope = scope, online = false)
        assertEquals(false, monitor.online.value)
    }

    @Test
    fun `hasBeenOnline is true when constructed with online=true`() {
        val monitor = FakeNetworkMonitor(scope = scope, online = true)
        assertTrue(monitor.hasBeenOnline)
    }

    @Test
    fun `hasBeenOnline is false when constructed with online=false`() {
        val monitor = FakeNetworkMonitor(scope = scope, online = false)
        assertEquals(false, monitor.hasBeenOnline)
    }

    @Test
    fun `hasBeenOnline flips true once the StateFlow emits true`() {
        val flow = MutableStateFlow(false)
        val monitor = FakeNetworkMonitor(scope = scope, flow = flow)
        assertEquals(false, monitor.hasBeenOnline)
        flow.value = true
        // Dispatchers.Unconfined makes the collector run synchronously.
        assertTrue(monitor.hasBeenOnline)
        // Flipping back to false does not clear the flag.
        flow.value = false
        assertTrue(monitor.hasBeenOnline)
    }
}

private class FakeNetworkMonitor(
    scope: CoroutineScope,
    online: Boolean = false,
    private val flow: MutableStateFlow<Boolean> = MutableStateFlow(online),
) : NetworkMonitor {
    override val online = flow
    private val hasBeenOnlineFlag = AtomicBoolean(online)

    init {
        // Mirror AndroidNetworkMonitor: latch the flag on every `true`.
        flow.onEach { if (it) hasBeenOnlineFlag.set(true) }.launchIn(scope)
    }

    override val hasBeenOnline: Boolean
        get() = hasBeenOnlineFlag.get()
}
