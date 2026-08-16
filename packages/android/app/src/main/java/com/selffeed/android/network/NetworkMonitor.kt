package com.selffeed.android.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
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
    val unmetered: StateFlow<Boolean>
        get() = online

    /** True once at least one validated network has been observed. */
    val hasBeenOnline: Boolean
}

class AndroidNetworkMonitor(
    private val context: Context,
    lifecycleOwner: LifecycleOwner = ProcessLifecycleOwner.get(),
) : NetworkMonitor, DefaultLifecycleObserver {

    private val _online = MutableStateFlow(false)
    override val online: StateFlow<Boolean> = _online.asStateFlow()
    private val _unmetered = MutableStateFlow(false)
    override val unmetered: StateFlow<Boolean> = _unmetered.asStateFlow()
    private val validatedNetworks = mutableMapOf<Network, NetworkCapabilities>()

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
            synchronized(validatedNetworks) {
                if (hasInternet && validated) validatedNetworks[network] = capabilities
                else validatedNetworks.remove(network)
                recalculateConnectivity()
            }
        }

        override fun onLost(network: Network) {
            log("onLost: $network")
            synchronized(validatedNetworks) {
                validatedNetworks.remove(network)
                recalculateConnectivity()
            }
        }
    }

    init {
        // Seed from current state so we don't emit a false→true transition on
        // launch when the device is already online.
        cm.activeNetwork?.let { network ->
            cm.getNetworkCapabilities(network)?.let { capabilities ->
                if (
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                ) {
                    validatedNetworks[network] = capabilities
                }
            }
        }
        recalculateConnectivity()

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

    private fun recalculateConnectivity() {
        val capabilities = validatedNetworks.values.toList()
        val online = capabilities.isNotEmpty()
        _online.value = online
        _unmetered.value = capabilities.any {
            it.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) &&
                (Build.VERSION.SDK_INT < Build.VERSION_CODES.P ||
                    it.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING))
        }
        if (online) hasBeenOnlineFlag.set(true)
    }

    private fun log(message: String) {
        if (com.selffeed.android.BuildConfig.DEBUG) {
            Log.d("NetworkMonitor", message)
        }
    }
}
