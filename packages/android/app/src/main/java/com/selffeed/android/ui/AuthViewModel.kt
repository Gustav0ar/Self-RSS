package com.selffeed.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.selffeed.android.R
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.ApiSession
import com.selffeed.android.data.repository.AuthenticatedSession
import com.selffeed.android.data.repository.AuthRepository
import com.selffeed.android.network.User
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.collect
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
    val session: ApiSession? = null,
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

    private var initialized = false
    private var authActionJob: Job? = null
    private var passwordChangeJob: Job? = null

    init {
        viewModelScope.launch {
            repository.authEvents().collect { message ->
                launchAuthAction {
                    showSignedOut(
                        repository.getApiBaseUrl(),
                        PresentationText.dynamic(message),
                    )
                }
            }
        }
    }

    fun bootstrap() {
        if (initialized) return
        launchAuthAction {
            val apiBaseUrl = repository.getApiBaseUrl()
            if (repository.isLoggedIn()) {
                when (val result = awaitActive { repository.restoreSession() }) {
                    is AppResult.Success -> _state.value = _state.value.copy(
                        loading = false,
                        isAuthenticated = true,
                        user = (result.data as? AuthenticatedSession.Verified)?.user,
                        session = result.data.session,
                        apiBaseUrl = result.data.session.apiBaseUrl,
                        errorMessage = null,
                    )

                    is AppResult.Error -> showSignedOut(
                        apiBaseUrl,
                        PresentationText.resource(R.string.auth_session_lost),
                    )
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
        launchAuthAction {
            _state.value = signedOutWhileLoading()
            saveApiBaseUrlOrStop(apiBaseUrl) ?: return@launchAuthAction
            when (val result = awaitActive { repository.login(email.trim(), password) }) {
                is AppResult.Success -> _state.value = _state.value.copy(
                    loading = false,
                    isAuthenticated = true,
                    user = result.data.user,
                    session = result.data.session,
                    apiBaseUrl = result.data.session.apiBaseUrl,
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
        launchAuthAction {
            _state.value = signedOutWhileLoading()
            saveApiBaseUrlOrStop(apiBaseUrl) ?: return@launchAuthAction
            when (val result = awaitActive { repository.register(email.trim(), password) }) {
                is AppResult.Success -> _state.value = _state.value.copy(
                    loading = false,
                    isAuthenticated = true,
                    user = result.data.user,
                    session = result.data.session,
                    apiBaseUrl = result.data.session.apiBaseUrl,
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
        launchAuthAction {
            _state.value = signedOutWhileLoading()
            awaitActive { repository.logout() }
            showSignedOut(repository.getApiBaseUrl())
        }
    }

    fun changePassword(currentPassword: String, newPassword: String) {
        if (!_state.value.isAuthenticated || _state.value.passwordChangePending) return
        _state.value = _state.value.copy(
            passwordChangePending = true,
            errorMessage = null,
            statusMessage = null,
        )
        val job = viewModelScope.launch(start = CoroutineStart.LAZY) {
            when (val result = awaitActive { repository.changePassword(currentPassword, newPassword) }) {
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
        passwordChangeJob = job
        job.start()
    }

    fun switchServerForExternalAction(serverOrigin: String) {
        launchAuthAction {
            _state.value = signedOutWhileLoading()
            // The local logout completes before a new server can receive credentials.
            awaitActive { repository.logout() }
            when (val result = awaitActive { repository.setApiBaseUrl(serverOrigin) }) {
                is AppResult.Success -> showSignedOut(result.data)
                is AppResult.Error -> _state.value = _state.value.copy(
                    loading = false,
                    errorMessage = result.message.toApiBaseUrlPresentationText(),
                )
            }
        }
    }

    /** A newer account command revokes earlier work before either can resume. */
    private fun launchAuthAction(block: suspend () -> Unit) {
        initialized = true
        authActionJob?.cancel()
        passwordChangeJob?.cancel()
        // Store before starting: an undispatched callback can synchronously issue another command.
        val job = viewModelScope.launch(start = CoroutineStart.LAZY) { block() }
        authActionJob = job
        job.start()
    }

    private fun signedOutWhileLoading() = AuthUiState(
        apiBaseUrl = _state.value.apiBaseUrl,
        authMode = _state.value.authMode,
        registrationEnabled = _state.value.registrationEnabled,
    )

    private suspend fun showSignedOut(apiBaseUrl: String, error: PresentationText? = null) {
        val signedOut = AuthUiState(loading = false, apiBaseUrl = apiBaseUrl, errorMessage = error)
        _state.value = signedOut
        val enabled = loadRegistrationEnabled()
        // awaitActive excludes a newer command; preserve edits to unrelated fields.
        _state.value = _state.value.copy(registrationEnabled = enabled)
    }

    /** Non-cooperative dependencies still cannot dispatch or publish after cancellation. */
    private suspend inline fun <T> awaitActive(block: () -> T): T {
        currentCoroutineContext().ensureActive()
        val value = block()
        currentCoroutineContext().ensureActive()
        return value
    }

    fun clearMessages() {
        _state.value = _state.value.copy(statusMessage = null, errorMessage = null)
    }

    private suspend fun loadRegistrationEnabled(): Boolean =
        when (val result = awaitActive { repository.registrationStatus() }) {
            is AppResult.Success -> result.data.registrationEnabled
            is AppResult.Error -> false
        }

    private suspend fun saveApiBaseUrlOrStop(rawApiBaseUrl: String): String? =
        when (val result = awaitActive { repository.setApiBaseUrl(rawApiBaseUrl) }) {
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
        // Local validation sentinels emitted by ApiBaseUrl. They stay
        // context-free here and are converted to localized presentation copy.
        const val INVALID_API_BASE_URL_MESSAGE = "Enter a valid server URL."
        const val INVALID_SERVER_HOST_MESSAGE =
            "Enter a valid server, for example 10.0.22.22:3000."
    }
}
