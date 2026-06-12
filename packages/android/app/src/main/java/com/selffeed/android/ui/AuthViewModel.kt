package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * UI state for the authentication screen (login + register).
 */
data class AuthUiState(
    val loading: Boolean = false,
    val isAuthenticated: Boolean = false,
    val authMode: AuthMode = AuthMode.LOGIN,
    val registrationEnabled: Boolean = false,
    val statusMessage: String? = null,
    val errorMessage: String? = null,
)

/**
 * Owns authentication flows: login, register, logout, and registration status.
 *
 * Extracted from the original `MainViewModel` so the auth screen has a
 * focused, easy-to-test surface and the parent VM can compose it as a
 * StateFlow.
 */
class AuthViewModel(
    private val repository: RssRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(AuthUiState())
    val state: StateFlow<AuthUiState> = _state.asStateFlow()

    fun bootstrap() {
        viewModelScope.launch {
            if (repository.isLoggedIn()) {
                _state.value = _state.value.copy(loading = false, isAuthenticated = true)
            } else {
                val enabled = loadRegistrationEnabled()
                _state.value = _state.value.copy(
                    loading = false,
                    isAuthenticated = false,
                    authMode = if (enabled) _state.value.authMode else AuthMode.LOGIN,
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

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, errorMessage = null, statusMessage = null)
            when (val result = repository.login(email.trim(), password)) {
                is AppResult.Success -> _state.value = _state.value.copy(
                    loading = false,
                    isAuthenticated = true,
                    statusMessage = "Welcome back",
                )
                is AppResult.Error -> _state.value = _state.value.copy(loading = false, errorMessage = result.message)
            }
        }
    }

    fun register(email: String, password: String) {
        if (!_state.value.registrationEnabled) {
            _state.value = _state.value.copy(
                loading = false,
                authMode = AuthMode.LOGIN,
                errorMessage = "Registration is currently closed",
            )
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, errorMessage = null, statusMessage = null)
            when (val result = repository.register(email.trim(), password)) {
                is AppResult.Success -> _state.value = _state.value.copy(
                    loading = false,
                    isAuthenticated = true,
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
            _state.value = AuthUiState(loading = false, registrationEnabled = enabled)
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

    class Factory(private val repository: RssRepository) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            @Suppress("UNCHECKED_CAST")
            return AuthViewModel(repository) as T
        }
    }
}
