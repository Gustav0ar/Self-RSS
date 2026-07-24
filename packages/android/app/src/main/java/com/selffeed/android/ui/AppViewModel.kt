package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.selffeed.android.data.SessionStore
import com.selffeed.android.data.repository.AppStatusRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Holds cross-screen state that doesn't belong to a single feature: the
 * currently selected tab, the online indicator, and the global status/error
 * message queue.
 */
data class AppChromeState(
    val activeTab: HomeTab = HomeTab.ARTICLES,
    val readerOrigin: HomeTab = HomeTab.ARTICLES,
    val isOnline: Boolean = true,
    val isSyncingFeeds: Boolean = false,
    val globalStatus: PresentationText? = null,
    val globalError: PresentationText? = null,
)

@HiltViewModel
class AppViewModel @Inject constructor(
    private val repository: AppStatusRepository,
    sessionStore: SessionStore,
) : ViewModel() {
    private val _chrome = MutableStateFlow(AppChromeState())
    val chrome: StateFlow<AppChromeState> = _chrome.asStateFlow()

    init {
        // Preload session data early to avoid runBlocking on main thread
        viewModelScope.launch {
            sessionStore.preload()
        }
    }

    /** Online state mirrored from the [com.selffeed.android.network.NetworkMonitor]. */
    val isOnline: StateFlow<Boolean> = repository.observeOnline()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), repository.isOnline())

    fun setTab(tab: HomeTab) {
        _chrome.value = _chrome.value.copy(activeTab = tab, globalError = null, globalStatus = null)
    }

    /**
     * Reader state is owned by ArticlesViewModel, but the originating tab
     * belongs to the app shell. Keeping it here makes Back return a search
     * result to Search instead of unexpectedly dropping the user into All
     * Articles.
     */
    fun openReaderFrom(origin: HomeTab) {
        _chrome.value = _chrome.value.copy(
            activeTab = HomeTab.ARTICLES,
            readerOrigin = origin,
            globalError = null,
            globalStatus = null,
        )
    }

    fun closeReader() {
        _chrome.value = _chrome.value.copy(activeTab = _chrome.value.readerOrigin)
    }

    fun setSyncingFeeds(syncing: Boolean) {
        _chrome.value = _chrome.value.copy(isSyncingFeeds = syncing)
    }

    fun postStatus(message: String?) {
        _chrome.value = _chrome.value.copy(globalStatus = message?.let(PresentationText::dynamic))
    }

    fun postError(message: String?) {
        _chrome.value = _chrome.value.copy(globalError = message?.let(PresentationText::dynamic))
    }

    fun clearMessages() {
        _chrome.value = _chrome.value.copy(globalError = null, globalStatus = null)
    }
}
