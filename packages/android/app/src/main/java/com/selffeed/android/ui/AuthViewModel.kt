package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * UI state for the authentication screen (login + register).
 */
data class AuthUiState(
    val loading: Boolean = true,
    val isAuthenticated: Boolean = false,
    val authMode: AuthMode = AuthMode.LOGIN,
    val apiBaseUrl: String = "",
    val registrationEnabled: Boolean = false,
    val statusMessage: String? = null,
    val errorMessage: String? = null,
)

/**
 * Owns authentication flows: login, register, logout, and registration status.
 *
 * Focused, easy-to-test state holder for auth screen state and events.
 */
@HiltViewModel
class AuthViewModel @Inject constructor(
    private val repository: AuthRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(AuthUiState())
    val state: StateFlow<AuthUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            repository.authEvents().collect { message ->
                val enabled = loadRegistrationEnabled()
                _state.value = AuthUiState(
                    loading = false,
                    isAuthenticated = false,
                    apiBaseUrl = repository.getApiBaseUrl(),
                    registrationEnabled = enabled,
                    errorMessage = message,
                )
            }
        }
    }

    fun bootstrap() {
        viewModelScope.launch {
            val apiBaseUrl = repository.getApiBaseUrl()
            if (repository.isLoggedIn()) {
                when (val result = repository.restoreSession()) {
                    is AppResult.Success -> _state.value = _state.value.copy(
                        loading = false,
                        isAuthenticated = true,
                        apiBaseUrl = apiBaseUrl,
                        errorMessage = null,
                    )
                    is AppResult.Error -> {
                        if (result.message == AUTH_LOST_MESSAGE) {
                            val enabled = loadRegistrationEnabled()
                            _state.value = _state.value.copy(
                                loading = false,
                                isAuthenticated = false,
                                authMode = AuthMode.LOGIN,
                                apiBaseUrl = apiBaseUrl,
                                registrationEnabled = enabled,
                                errorMessage = result.message,
                            )
                        } else {
                            _state.value = _state.value.copy(
                                loading = false,
                                isAuthenticated = true,
                                apiBaseUrl = apiBaseUrl,
                                errorMessage = null,
                            )
                        }
                    }
                }
            } else {
                val enabled = loadRegistrationEnabled()
                _state.value = _state.value.copy(
                    loading = false,
                    isAuthenticated = false,
                    authMode = if (enabled) _state.value.authMode else AuthMode.LOGIN,
                    apiBaseUrl = apiBaseUrl,
                    registrationEnabled = enabled,
                )
            }
        }
    }

    fun setAuthMode(mode: AuthMode) {
        if (mode == AuthMode.REGISTER && !_state.value.registrationEnabled) {
            _state.value = _state.value.copy(authMode = AuthMode.LOGIN, errorMessage = "Registration is currently closed")
            return
        }
        _state.value = _state.value.copy(authMode = mode, errorMessage = null)
    }

    fun login(email: String, password: String, apiBaseUrl: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(
                loading = true,
                errorMessage = null,
                statusMessage = null,
            )
            val normalizedApiBaseUrl = saveApiBaseUrlOrStop(apiBaseUrl) ?: return@launch
            when (val result = repository.login(email.trim(), password)) {
                is AppResult.Success -> _state.value = _state.value.copy(
                    loading = false,
                    isAuthenticated = true,
                    apiBaseUrl = normalizedApiBaseUrl,
                    statusMessage = "Welcome back",
                )
                is AppResult.Error -> _state.value = _state.value.copy(loading = false, errorMessage = result.message)
            }
        }
    }

    fun register(email: String, password: String, apiBaseUrl: String) {
        if (!_state.value.registrationEnabled) {
            _state.value = _state.value.copy(
                loading = false,
                authMode = AuthMode.LOGIN,
                errorMessage = "Registration is currently closed",
            )
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(
                loading = true,
                errorMessage = null,
                statusMessage = null,
            )
            val normalizedApiBaseUrl = saveApiBaseUrlOrStop(apiBaseUrl) ?: return@launch
            when (val result = repository.register(email.trim(), password)) {
                is AppResult.Success -> _state.value = _state.value.copy(
                    loading = false,
                    isAuthenticated = true,
                    apiBaseUrl = normalizedApiBaseUrl,
                    statusMessage = "Account created",
                )
                is AppResult.Error -> _state.value = _state.value.copy(loading = false, errorMessage = result.message)
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            val enabled = loadRegistrationEnabled()
            _state.value = AuthUiState(
                loading = false,
                apiBaseUrl = repository.getApiBaseUrl(),
                registrationEnabled = enabled,
            )
        }
    }

    fun clearMessages() {
        _state.value = _state.value.copy(statusMessage = null, errorMessage = null)
    }

    private suspend fun loadRegistrationEnabled(): Boolean =
        when (val result = repository.registrationStatus()) {
            is AppResult.Success -> result.data.registrationEnabled
            is AppResult.Error -> false
        }

    private suspend fun saveApiBaseUrlOrStop(rawApiBaseUrl: String): String? =
        when (val result = repository.setApiBaseUrl(rawApiBaseUrl)) {
            is AppResult.Success -> result.data.also { normalized ->
                _state.value = _state.value.copy(apiBaseUrl = normalized)
            }
            is AppResult.Error -> {
                _state.value = _state.value.copy(
                    loading = false,
                    errorMessage = result.message,
                )
                null
            }
        }

    private companion object {
        const val AUTH_LOST_MESSAGE = "Authentication was lost. Please sign in again."
    }
}
