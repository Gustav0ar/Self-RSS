package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.selffeed.android.BuildConfig
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.UpdateAppSettingsRequest
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.UserPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SettingsUiState(
    val preferences: UserPreferences? = null,
    val stats: StatsResponse? = null,
    val adminRegistrationLocked: Boolean? = null,
    val debugSnapshot: Map<String, Long> = emptyMap(),
    val loading: Boolean = false,
    val statusMessage: String? = null,
    val errorMessage: String? = null,
)

/**
 * Owns the settings and stats tab: preferences, stats dashboard, admin
 * controls, and the debug resilience metrics.
 */
class SettingsViewModel(
    private val repository: RssRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    fun loadPreferences() {
        viewModelScope.launch {
            when (val result = repository.preferences()) {
                is AppResult.Success -> {
                    val normalized = result.data.withNormalizedTheme()
                    _state.update { it.copy(preferences = normalized) }
                    if (normalized.theme != result.data.theme) {
                        // The server still says "amoled"; rewrite to "dark"
                        // and persist.
                        updatePreferences(UpdatePreferencesRequest(theme = "dark"))
                    }
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updatePreferences(request: UpdatePreferencesRequest) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(request)) {
                is AppResult.Success -> _state.update {
                    it.copy(preferences = result.data.withNormalizedTheme(), statusMessage = "Preferences saved")
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun updateTheme(theme: String) {
        val normalized = if (theme == "amoled") "dark" else theme
        updatePreferences(UpdatePreferencesRequest(theme = normalized))
    }

    fun updateHideRead(hideRead: Boolean) = updatePreferences(UpdatePreferencesRequest(hideRead = hideRead))
    fun updateTextSize(textSize: Int) = updatePreferences(UpdatePreferencesRequest(textSize = textSize.coerceIn(12, 24)))
    fun updateDensity(density: String) = updatePreferences(UpdatePreferencesRequest(density = density))
    fun updateDefaultSort(sort: String) = updatePreferences(UpdatePreferencesRequest(defaultSort = sort))
    fun updateAutoMarkReadMode(mode: String) = updatePreferences(UpdatePreferencesRequest(autoMarkReadMode = mode))
    fun updateFontFamily(family: String) = updatePreferences(UpdatePreferencesRequest(fontFamily = family))

    fun loadStats() {
        viewModelScope.launch {
            when (val result = repository.stats()) {
                is AppResult.Success -> {
                    _state.update { it.copy(stats = result.data) }
                    loadDebugSnapshot()
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun loadAdminSettings() {
        viewModelScope.launch {
            when (val result = repository.adminSettings()) {
                is AppResult.Success -> _state.update { it.copy(adminRegistrationLocked = result.data.registrationLocked) }
                is AppResult.Error -> { /* admin not available; leave state alone */ }
            }
        }
    }

    fun toggleRegistrationLock(locked: Boolean) {
        viewModelScope.launch {
            when (val result = repository.updateAdminSettings(locked)) {
                is AppResult.Success -> _state.update {
                    it.copy(adminRegistrationLocked = result.data.registrationLocked, statusMessage = if (locked) "Registration locked" else "Registration unlocked")
                }
                is AppResult.Error -> _state.update { it.copy(errorMessage = result.message) }
            }
        }
    }

    fun loadDebugSnapshot() {
        if (!BuildConfig.DEBUG) return
        _state.update { it.copy(debugSnapshot = repository.getDebugResilienceSnapshot()) }
    }

    fun resetDebugResilienceMetrics() {
        if (!BuildConfig.DEBUG) return
        repository.resetDebugResilienceMetrics()
        loadDebugSnapshot()
    }

    fun clearMessages() {
        _state.update { it.copy(errorMessage = null, statusMessage = null) }
    }

    private fun UserPreferences.withNormalizedTheme(): UserPreferences {
        val normalized = if (theme == "amoled") "dark" else theme
        return if (theme == normalized) this else copy(theme = normalized)
    }

    class Factory(private val repository: RssRepository) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            @Suppress("UNCHECKED_CAST")
            return SettingsViewModel(repository) as T
        }
    }
}
