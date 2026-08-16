package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.selffeed.android.R
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.AuthRepository
import com.selffeed.android.network.User
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
    val user: User? = null,
    val passwordChangePending: Boolean = false,
    val passwordChangeGeneration: Long = 0,
    val statusMessage: PresentationText? = null,
    val errorMessage: PresentationText? = null,
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
                    errorMessage = PresentationText.dynamic(message),
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
                        user = result.data,
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
                                errorMessage = PresentationText.resource(R.string.auth_session_lost),
                            )
                        } else if (repository.canUseOfflineSession()) {
                            repository.recordOfflineRestore()
                            _state.value = _state.value.copy(
                                loading = false,
                                isAuthenticated = true,
                                apiBaseUrl = apiBaseUrl,
                                errorMessage = null,
                            )
                        } else {
                            val enabled = loadRegistrationEnabled()
                            _state.value = _state.value.copy(
                                loading = false,
                                isAuthenticated = false,
                                authMode = AuthMode.LOGIN,
                                apiBaseUrl = apiBaseUrl,
                                registrationEnabled = enabled,
                                errorMessage = PresentationText.resource(R.string.auth_session_lost),
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
            _state.value = _state.value.copy(
                authMode = AuthMode.LOGIN,
                errorMessage = PresentationText.resource(R.string.auth_registration_closed),
            )
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
                    user = result.data,
                    apiBaseUrl = normalizedApiBaseUrl,
                    statusMessage = PresentationText.resource(R.string.auth_welcome_back),
                )

                is AppResult.Error -> _state.value = _state.value.copy(
                    loading = false,
                    errorMessage = PresentationText.dynamic(result.message),
                )
            }
        }
    }

    fun register(email: String, password: String, apiBaseUrl: String) {
        if (!_state.value.registrationEnabled) {
            _state.value = _state.value.copy(
                loading = false,
                authMode = AuthMode.LOGIN,
                errorMessage = PresentationText.resource(R.string.auth_registration_closed),
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
                    user = result.data,
                    apiBaseUrl = normalizedApiBaseUrl,
                    statusMessage = PresentationText.resource(R.string.auth_account_created),
                )

                is AppResult.Error -> _state.value = _state.value.copy(
                    loading = false,
                    errorMessage = PresentationText.dynamic(result.message),
                )
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

    fun changePassword(currentPassword: String, newPassword: String) {
        if (_state.value.passwordChangePending) return
        viewModelScope.launch {
            _state.value = _state.value.copy(
                passwordChangePending = true,
                errorMessage = null,
                statusMessage = null,
            )
            when (val result = repository.changePassword(currentPassword, newPassword)) {
                is AppResult.Success -> _state.value = _state.value.copy(
                    user = result.data,
                    passwordChangePending = false,
                    passwordChangeGeneration = _state.value.passwordChangeGeneration + 1,
                    statusMessage = PresentationText.resource(R.string.settings_password_updated),
                )

                is AppResult.Error -> _state.value = _state.value.copy(
                    passwordChangePending = false,
                    errorMessage = PresentationText.dynamic(result.message),
                )
            }
        }
    }

    fun switchServerForExternalAction(serverOrigin: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, errorMessage = null)
            // Revoke the old session when reachable. Changing the base URL
            // still clears local credentials if that best-effort call fails.
            repository.logout()
            when (val result = repository.setApiBaseUrl(serverOrigin)) {
                is AppResult.Success -> {
                    val enabled = loadRegistrationEnabled()
                    _state.value = AuthUiState(
                        loading = false,
                        apiBaseUrl = result.data,
                        registrationEnabled = enabled,
                    )
                }

                is AppResult.Error -> _state.value = _state.value.copy(
                    loading = false,
                    errorMessage = result.message.toApiBaseUrlPresentationText(),
                )
            }
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
                    errorMessage = result.message.toApiBaseUrlPresentationText(),
                )
                null
            }
        }

    private fun String.toApiBaseUrlPresentationText(): PresentationText = when (this) {
        INVALID_API_BASE_URL_MESSAGE ->
            PresentationText.resource(R.string.auth_invalid_server_url)

        INVALID_SERVER_HOST_MESSAGE ->
            PresentationText.resource(R.string.auth_invalid_server_host)

        else -> PresentationText.dynamic(this)
    }

    private companion object {
        // Protocol sentinel returned by the API. Compare the wire value here,
        // then present localized app copy through auth_session_lost.
        const val AUTH_LOST_MESSAGE = "Authentication was lost. Please sign in again."

        // Local validation sentinels emitted by ApiBaseUrl. They stay
        // context-free here and are converted to localized presentation copy.
        const val INVALID_API_BASE_URL_MESSAGE = "Enter a valid server URL."
        const val INVALID_SERVER_HOST_MESSAGE =
            "Enter a valid server, for example 10.0.22.22:3000."
    }
}
