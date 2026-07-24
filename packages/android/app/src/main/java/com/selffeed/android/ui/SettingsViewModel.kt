package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.selffeed.android.BuildConfig
import com.selffeed.android.R
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import com.selffeed.android.network.AuthSession
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.UpdateAppSettingsRequest
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.UserPreferences
import com.selffeed.android.network.User
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val preferences: UserPreferences? = null,
    val preferencesLoading: Boolean = false,
    val preferencesLoadError: PresentationText? = null,
    val stats: StatsResponse? = null,
    val authSessions: List<AuthSession> = emptyList(),
    val adminRegistrationLocked: Boolean? = null,
    val adminUsers: List<User> = emptyList(),
    val debugSnapshot: Map<String, Long> = emptyMap(),
    val loading: Boolean = false,
    val statusMessage: PresentationText? = null,
    val errorMessage: PresentationText? = null,
)

/**
 * Owns the settings and stats tab: preferences, stats dashboard, admin
 * controls, and the debug resilience metrics.
 */
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repository: SettingsRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    fun loadPreferences() {
        if (_state.value.preferencesLoading) return
        _state.update { it.copy(preferencesLoading = true, preferencesLoadError = null) }
        viewModelScope.launch {
            when (val result = repository.preferences()) {
                is AppResult.Success -> {
                    val normalized = result.data.withNormalizedTheme()
                    _state.update {
                        it.copy(
                            preferences = normalized,
                            preferencesLoading = false,
                            preferencesLoadError = null,
                        )
                    }
                    if (normalized.theme != result.data.theme) {
                        // The server still says "amoled"; rewrite to "dark"
                        // and persist.
                        updatePreferences(UpdatePreferencesRequest(theme = "dark"))
                    }
                }
                is AppResult.Error -> _state.update {
                    it.copy(
                        preferencesLoading = false,
                        preferencesLoadError = PresentationText.dynamic(result.message),
                        errorMessage = PresentationText.dynamic(result.message),
                    )
                }
            }
        }
    }

    fun updatePreferences(request: UpdatePreferencesRequest) {
        viewModelScope.launch {
            when (val result = repository.updatePreferences(request)) {
                is AppResult.Success -> _state.update {
                    it.copy(
                        preferences = result.data.withNormalizedTheme(),
                        statusMessage = PresentationText.resource(R.string.settings_saved),
                    )
                }
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
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
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun loadAuthSessions() {
        viewModelScope.launch {
            when (val result = repository.authSessions()) {
                is AppResult.Success -> _state.update { it.copy(authSessions = result.data) }
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun revokeAuthSession(id: String) {
        viewModelScope.launch {
            when (val result = repository.revokeAuthSession(id)) {
                is AppResult.Success -> {
                    _state.update {
                        it.copy(
                            authSessions = it.authSessions.filterNot { session -> session.id == id },
                            statusMessage = PresentationText.resource(R.string.settings_session_revoked),
                        )
                    }
                    loadAuthSessions()
                }
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun applyStatsDelta(unreadDelta: Int, readDelta: Int) {
        if (unreadDelta == 0 && readDelta == 0) return
        _state.update { state ->
            state.copy(
                stats = state.stats?.let {
                    UnreadStateReducer.applyStatsDelta(
                        stats = it,
                        unreadDelta = unreadDelta,
                        readDelta = readDelta,
                    )
                },
            )
        }
    }

    fun loadAdminSettings() {
        viewModelScope.launch {
            when (val result = repository.adminSettings()) {
                is AppResult.Success -> _state.update { it.copy(adminRegistrationLocked = result.data.registrationLocked) }
                is AppResult.Error -> { /* admin not available; leave state alone */ }
            }
            loadAdminUsers()
        }
    }

    fun loadAdminUsers() {
        viewModelScope.launch {
            when (val result = repository.adminUsers()) {
                is AppResult.Success -> _state.update { it.copy(adminUsers = result.data) }
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun createAdminUser(email: String, password: String, role: String) {
        viewModelScope.launch {
            when (val result = repository.adminCreateUser(email.trim(), password, role)) {
                is AppResult.Success -> {
                    _state.update {
                        it.copy(
                            adminUsers = listOf(result.data) + it.adminUsers,
                            statusMessage = PresentationText.resource(R.string.settings_admin_user_created),
                        )
                    }
                }
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun updateAdminUser(id: String, role: String? = null, isActive: Boolean? = null) {
        viewModelScope.launch {
            when (val result = repository.adminUpdateUser(id, role, isActive)) {
                is AppResult.Success -> _state.update { state ->
                    state.copy(
                        adminUsers = state.adminUsers.map { user ->
                            if (user.id == id) result.data else user
                        },
                        statusMessage = PresentationText.resource(R.string.settings_admin_user_updated),
                    )
                }
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun resetAdminPassword(id: String, password: String) {
        viewModelScope.launch {
            when (val result = repository.adminResetPassword(id, password)) {
                is AppResult.Success -> _state.update {
                    it.copy(statusMessage = PresentationText.resource(R.string.settings_admin_password_reset))
                }
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
            }
        }
    }

    fun toggleRegistrationLock(locked: Boolean) {
        viewModelScope.launch {
            when (val result = repository.updateAdminSettings(locked)) {
                is AppResult.Success -> _state.update {
                    it.copy(
                        adminRegistrationLocked = result.data.registrationLocked,
                        statusMessage = PresentationText.resource(
                            if (locked) {
                                R.string.settings_registration_locked
                            } else {
                                R.string.settings_registration_unlocked
                            },
                        ),
                    )
                }
                is AppResult.Error -> _state.update {
                    it.copy(errorMessage = PresentationText.dynamic(result.message))
                }
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
}
