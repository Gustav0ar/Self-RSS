package com.selffeed.android.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Observes validated network connectivity at the process level. Used to:
 * - Pause/resume the SSE read-state stream when connectivity is lost/gained.
 * - Skip retries when the device is known to be offline (faster failure path).
 * - Surface an online indicator to the UI.
 *
 * The StateFlow starts `false` and is updated to `true` only once a network
 * with the INTERNET capability and validated status is observed. We use the
 * [ProcessLifecycleOwner] so callbacks are unregistered when the process is
 * fully torn down.
 */
interface NetworkMonitor {
    val online: StateFlow<Boolean>

    /** True once at least one validated network has been observed. */
    val hasBeenOnline: Boolean
}

class AndroidNetworkMonitor(
    private val context: Context,
    lifecycleOwner: LifecycleOwner = ProcessLifecycleOwner.get(),
) : NetworkMonitor, DefaultLifecycleObserver {

    private val _online = MutableStateFlow(false)
    override val online: StateFlow<Boolean> = _online.asStateFlow()

    private val hasBeenOnlineFlag = AtomicBoolean(false)
    override val hasBeenOnline: Boolean
        get() = hasBeenOnlineFlag.get()

    private val cm: ConnectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            // onCapabilitiesChanged is the source of truth for validated access;
            // onAvailable alone can fire for a captive portal that's still
            // unvalidated.
            log("onAvailable: $network")
        }

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            val hasInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            val validated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            val isOnline = hasInternet && validated
            if (isOnline) hasBeenOnlineFlag.set(true)
            _online.value = isOnline
        }

        override fun onLost(network: Network) {
            log("onLost: $network")
            // Re-evaluate in case no other validated network is active.
            _online.value = currentValidated()
        }
    }

    init {
        // Seed from current state so we don't emit a false→true transition on
        // launch when the device is already online.
        _online.value = currentValidated()
        if (_online.value) hasBeenOnlineFlag.set(true)

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, callback)

        lifecycleOwner.lifecycle.addObserver(this)
    }

    override fun onStop(owner: LifecycleOwner) {
        // No-op: keep monitoring so the next app-open knows the real state.
    }

    override fun onDestroy(owner: LifecycleOwner) {
        runCatching { cm.unregisterNetworkCallback(callback) }
    }

    private fun currentValidated(): Boolean {
        val active = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(active) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun log(message: String) {
        if (com.selffeed.android.BuildConfig.DEBUG) {
            Log.d("NetworkMonitor", message)
        }
    }
}
