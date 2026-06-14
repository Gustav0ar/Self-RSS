package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.selffeed.android.data.repository.AppStatusRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * Holds cross-screen state that doesn't belong to a single feature: the
 * currently selected tab, the online indicator, and the global status/error
 * message queue.
 */
data class AppChromeState(
    val activeTab: HomeTab = HomeTab.ARTICLES,
    val isOnline: Boolean = true,
    val isSyncingFeeds: Boolean = false,
    val globalStatus: String? = null,
    val globalError: String? = null,
)

class AppViewModel(
    private val repository: AppStatusRepository,
) : ViewModel() {
    private val _chrome = MutableStateFlow(AppChromeState())
    val chrome: StateFlow<AppChromeState> = _chrome.asStateFlow()

    /** Online state mirrored from the [com.selffeed.android.network.NetworkMonitor]. */
    val isOnline: StateFlow<Boolean> = repository.observeOnline()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), repository.isOnline())

    fun setTab(tab: HomeTab) {
        _chrome.value = _chrome.value.copy(activeTab = tab, globalError = null, globalStatus = null)
    }

    fun setSyncingFeeds(syncing: Boolean) {
        _chrome.value = _chrome.value.copy(isSyncingFeeds = syncing)
    }

    fun postStatus(message: String?) {
        _chrome.value = _chrome.value.copy(globalStatus = message)
    }

    fun postError(message: String?) {
        _chrome.value = _chrome.value.copy(globalError = message)
    }

    fun clearMessages() {
        _chrome.value = _chrome.value.copy(globalError = null, globalStatus = null)
    }

    class Factory(private val repository: AppStatusRepository) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            @Suppress("UNCHECKED_CAST")
            return AppViewModel(repository) as T
        }
    }
}
