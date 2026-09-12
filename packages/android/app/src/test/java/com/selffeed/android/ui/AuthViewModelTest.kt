package com.selffeed.android.ui

import com.selffeed.android.R
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.ApiSession
import com.selffeed.android.data.repository.AuthenticatedSession
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.normalizeApiServerHost
import com.selffeed.android.network.RegistrationStatusResponse
import com.selffeed.android.network.User
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {
    private lateinit var repository: RssRepository
    private var configuredServer = DEFAULT_API_BASE_URL
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        every { repository.getApiBaseUrl() } answers { configuredServer }
        every { repository.isLoggedIn() } returns false
        every { repository.authEvents() } returns emptyFlow()
        coEvery { repository.setApiBaseUrl(any()) } answers {
            configuredServer = normalizeApiServerHost(firstArg())
            AppResult.Success(configuredServer)
        }
        coEvery { repository.registrationStatus() } returns AppResult.Success(
            RegistrationStatusResponse(registrationEnabled = true),
        )
        coEvery { repository.login(any(), any()) } answers { AppResult.Success(verifiedSession()) }
        coEvery { repository.register(any(), any()) } answers { AppResult.Success(verifiedSession()) }
        coEvery { repository.restoreSession() } answers { AppResult.Success(verifiedSession()) }
        coEvery { repository.logout() } returns AppResult.Success(true)
        coEvery { repository.changePassword(any(), any()) } returns AppResult.Success(sampleUser())
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `a delayed auth loss lookup cannot reset a newer successful login`() = runTest {
        val events = kotlinx.coroutines.flow.MutableSharedFlow<String>()
        every { repository.authEvents() } returns events
        val entered = kotlinx.coroutines.CompletableDeferred<Unit>()
        val release = kotlinx.coroutines.CompletableDeferred<Unit>()
        coEvery { repository.registrationStatus() } coAnswers {
            entered.complete(Unit)
            kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { release.await() }
            AppResult.Success(RegistrationStatusResponse(true))
        }
        val viewModel = AuthViewModel(repository)
        val owner = androidx.lifecycle.ViewModelStore().apply { put("auth", viewModel) }
        try {
            events.emit("Expired")
            entered.await()
            viewModel.login("new@example.com", "password", DEFAULT_API_BASE_URL)
            assertTrue(viewModel.state.value.isAuthenticated)
            release.complete(Unit)
            runCurrent()
            assertTrue(viewModel.state.value.isAuthenticated)
        } finally { release.complete(Unit); owner.clear() }
    }

    @Test
    fun `cancelled registration lookup does not stop later authentication loss events`() = runTest {
        val events = kotlinx.coroutines.flow.MutableSharedFlow<String>()
        every { repository.authEvents() } returns events
        coEvery { repository.registrationStatus() } throws kotlinx.coroutines.CancellationException("Session changed")
        val viewModel = AuthViewModel(repository)
        val owner = androidx.lifecycle.ViewModelStore().apply { put("auth", viewModel) }
        try {
            events.emit("Expired")
            runCurrent()
            coEvery { repository.registrationStatus() } returns AppResult.Success(RegistrationStatusResponse(true))
            viewModel.login("new@example.com", "password", DEFAULT_API_BASE_URL)
            assertTrue(viewModel.state.value.isAuthenticated)
            events.emit("Expired again")
            runCurrent()
            assertFalse(viewModel.state.value.isAuthenticated)
            assertEquals(PresentationText.dynamic("Expired again"), viewModel.state.value.errorMessage)
        } finally { owner.clear() }
    }

    @Test
    fun `bootstrap with no session sets registration enabled and unauthenticated`() = runTest {
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        val state = viewModel.state.value
        assertFalse(state.loading)
        assertFalse(state.isAuthenticated)
        assertTrue(state.registrationEnabled)
        assertEquals(AuthMode.LOGIN, state.authMode)
        assertEquals(DEFAULT_API_BASE_URL, state.apiBaseUrl)
    }

    @Test
    fun `bootstrap with existing session sets authenticated`() = runTest {
        every { repository.isLoggedIn() } returns true
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        val state = viewModel.state.value
        assertFalse(state.loading)
        assertTrue(state.isAuthenticated)
        assertEquals(DEFAULT_API_BASE_URL, state.apiBaseUrl)
        coVerify { repository.restoreSession() }
    }

    @Test
    fun `bootstrap with revoked saved session redirects to login with message`() = runTest {
        every { repository.isLoggedIn() } returns true
        coEvery { repository.restoreSession() } returns AppResult.Error("Authentication was lost. Please sign in again.")
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        val state = viewModel.state.value
        assertFalse(state.loading)
        assertFalse(state.isAuthenticated)
        assertEquals(
            PresentationText.resource(R.string.auth_session_lost),
            state.errorMessage,
        )
        assertTrue(state.registrationEnabled)
    }

    @Test
    fun `bootstrap with transient saved session restore failure keeps authenticated`() = runTest {
        every { repository.isLoggedIn() } returns true
        coEvery { repository.restoreSession() } returns AppResult.Success(
            AuthenticatedSession.Offline(verifiedSession().session),
        )
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        val state = viewModel.state.value
        assertFalse(state.loading)
        assertTrue(state.isAuthenticated)
        assertNull(state.errorMessage)
        assertEquals(DEFAULT_API_BASE_URL, state.apiBaseUrl)
        assertEquals(verifiedSession().session, state.session)
        assertNull(state.user)
    }

    @Test
    fun `bootstrap with registration API failure disables registration`() = runTest {
        coEvery { repository.registrationStatus() } returns AppResult.Error("status unavailable")
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        val state = viewModel.state.value
        assertFalse(state.registrationEnabled)
    }

    @Test
    fun `login success transitions to authenticated with status message`() = runTest {
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.login("reader@example.com", "password123", "10.0.22.22:3000")
        val state = viewModel.state.value
        assertTrue(state.isAuthenticated)
        assertEquals(PresentationText.resource(R.string.auth_welcome_back), state.statusMessage)
        assertNull(state.errorMessage)
        assertEquals("10.0.22.22:3000", state.apiBaseUrl)
        assertEquals(verifiedSession().session, state.session)
        coVerify { repository.setApiBaseUrl("10.0.22.22:3000") }
        coVerify { repository.login("reader@example.com", "password123") }
    }

    @Test
    fun `login failure surfaces error message and keeps unauthenticated`() = runTest {
        coEvery { repository.login(any(), any()) } returns AppResult.Error("Bad credentials")
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.login("reader@example.com", "wrong", DEFAULT_API_BASE_URL)
        val state = viewModel.state.value
        assertFalse(state.isAuthenticated)
        assertEquals(PresentationText.dynamic("Bad credentials"), state.errorMessage)
    }

    @Test
    fun `login stops before network call when server host is invalid`() = runTest {
        coEvery { repository.setApiBaseUrl(any()) } returns AppResult.Error("Enter a valid server URL.")
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()

        viewModel.login("reader@example.com", "password123", "not a url")

        val state = viewModel.state.value
        assertFalse(state.loading)
        assertFalse(state.isAuthenticated)
        assertEquals(DEFAULT_API_BASE_URL, state.apiBaseUrl)
        assertEquals(
            PresentationText.resource(R.string.auth_invalid_server_url),
            state.errorMessage,
        )
        coVerify(exactly = 0) { repository.login(any(), any()) }
    }

    @Test
    fun `login local invalid server host uses localized example guidance`() = runTest {
        coEvery { repository.setApiBaseUrl(any()) } returns AppResult.Error(
            "Enter a valid server, for example 10.0.22.22:3000.",
        )
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()

        viewModel.login("reader@example.com", "password123", "://")

        val state = viewModel.state.value
        assertFalse(state.loading)
        assertFalse(state.isAuthenticated)
        assertEquals(
            PresentationText.resource(R.string.auth_invalid_server_host),
            state.errorMessage,
        )
        coVerify(exactly = 0) { repository.login(any(), any()) }
    }

    @Test
    fun `login unrelated server setup error remains dynamic`() = runTest {
        coEvery { repository.setApiBaseUrl(any()) } returns AppResult.Error(
            "Server configuration unavailable",
        )
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()

        viewModel.login("reader@example.com", "password123", DEFAULT_API_BASE_URL)

        val state = viewModel.state.value
        assertFalse(state.loading)
        assertFalse(state.isAuthenticated)
        assertEquals(
            PresentationText.dynamic("Server configuration unavailable"),
            state.errorMessage,
        )
        coVerify(exactly = 0) { repository.login(any(), any()) }
    }

    @Test
    fun `register is blocked when registration is disabled`() = runTest {
        coEvery { repository.registrationStatus() } returns AppResult.Success(
            RegistrationStatusResponse(registrationEnabled = false),
        )
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.register("new@example.com", "password", DEFAULT_API_BASE_URL)
        val state = viewModel.state.value
        assertFalse(state.isAuthenticated)
        assertEquals(
            PresentationText.resource(R.string.auth_registration_closed),
            state.errorMessage,
        )
        coVerify(exactly = 0) { repository.register(any(), any()) }
    }

    @Test
    fun `register success transitions to authenticated`() = runTest {
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.register("new@example.com", "password", DEFAULT_API_BASE_URL)
        val state = viewModel.state.value
        assertTrue(state.isAuthenticated)
        assertEquals(PresentationText.resource(R.string.auth_account_created), state.statusMessage)
    }

    @Test
    fun `setAuthMode to REGISTER requires registration enabled`() = runTest {
        coEvery { repository.registrationStatus() } returns AppResult.Success(
            RegistrationStatusResponse(registrationEnabled = false),
        )
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.setAuthMode(AuthMode.REGISTER)
        val state = viewModel.state.value
        // Bounces back to LOGIN with an error.
        assertEquals(AuthMode.LOGIN, state.authMode)
        assertEquals(
            PresentationText.resource(R.string.auth_registration_closed),
            state.errorMessage,
        )
    }

    @Test
    fun `setAuthMode to LOGIN clears the error`() = runTest {
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.setAuthMode(AuthMode.LOGIN)
        assertNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `logout resets to unauthenticated and re-fetches registration status`() = runTest {
        every { repository.isLoggedIn() } returns true
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        assertTrue(viewModel.state.value.isAuthenticated)
        viewModel.logout()
        val state = viewModel.state.value
        assertFalse(state.isAuthenticated)
        coVerify { repository.logout() }
    }

    @Test
    fun `changePassword keeps the rotated session and reports success`() = runTest {
        val viewModel = AuthViewModel(repository)
        viewModel.login("reader@example.com", "password123", DEFAULT_API_BASE_URL)

        viewModel.changePassword("password123", "new-password-123")

        val state = viewModel.state.value
        assertFalse(state.passwordChangePending)
        assertEquals(1L, state.passwordChangeGeneration)
        assertEquals(
            PresentationText.resource(R.string.settings_password_updated),
            state.statusMessage,
        )
        coVerify { repository.changePassword("password123", "new-password-123") }
    }

    @Test
    fun `confirmed external server switch revokes locally and waits for a new login`() = runTest {
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()

        viewModel.switchServerForExternalAction("https://other.example")

        assertFalse(viewModel.state.value.isAuthenticated)
        assertEquals("other.example", viewModel.state.value.apiBaseUrl)
        coVerifyOrder {
            repository.logout()
            repository.setApiBaseUrl("https://other.example")
        }
    }

    @Test
    fun `clearMessages wipes both error and status`() = runTest {
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.login("x@x.com", "x", DEFAULT_API_BASE_URL)
        assertTrue(viewModel.state.value.isAuthenticated)
        viewModel.clearMessages()
        val state = viewModel.state.value
        assertNull(state.errorMessage)
        assertNull(state.statusMessage)
    }

    @Test
    fun `superseded login cannot send credentials after delayed server setup`() = runTest {
        val release = CompletableDeferred<Unit>()
        coEvery { repository.setApiBaseUrl("old.example") } coAnswers {
            withContext(NonCancellable) { release.await() }
            AppResult.Success("old.example")
        }
        coEvery { repository.login("new@example.com", any()) } returns
            AppResult.Success(verifiedSession().copy(session = verifiedSession().session.copy(apiBaseUrl = "new.example"), user = sampleUser().copy(id = "new-user")))
        withViewModel { viewModel ->
            try {
                viewModel.login("old@example.com", "old-password", "old.example")
                viewModel.login("new@example.com", "new-password", "new.example")
                release.complete(Unit)
                runCurrent()
                coVerify(exactly = 0) { repository.login("old@example.com", any()) }
                assertEquals("new-user", viewModel.state.value.user?.id)
                assertEquals("new.example", viewModel.state.value.apiBaseUrl)
            } finally { release.complete(Unit) }
        }
    }

    @Test
    fun `server switch supersedes registration waiting for server setup`() = runTest {
        val release = CompletableDeferred<Unit>()
        coEvery { repository.setApiBaseUrl("old.example") } coAnswers {
            withContext(NonCancellable) { release.await() }
            AppResult.Success("old.example")
        }
        withViewModel { viewModel ->
            try {
                viewModel.bootstrap()
                viewModel.register("old@example.com", "password", "old.example")
                viewModel.switchServerForExternalAction("new.example")
                release.complete(Unit)
                runCurrent()
                coVerify(exactly = 0) { repository.register(any(), any()) }
                assertFalse(viewModel.state.value.isAuthenticated)
                assertEquals("new.example", viewModel.state.value.apiBaseUrl)
            } finally { release.complete(Unit) }
        }
    }

    @Test
    fun `logout supersedes a delayed session restore`() = runTest {
        val release = CompletableDeferred<Unit>()
        every { repository.isLoggedIn() } returns true
        coEvery { repository.restoreSession() } coAnswers {
            withContext(NonCancellable) { release.await() }
            AppResult.Success(verifiedSession())
        }
        withViewModel { viewModel ->
            try {
                viewModel.bootstrap()
                viewModel.logout()
                release.complete(Unit)
                runCurrent()
                assertFalse(viewModel.state.value.isAuthenticated)
                assertNull(viewModel.state.value.user)
            } finally { release.complete(Unit) }
        }
    }

    @Test
    fun `logout clears account state before registration metadata finishes`() = runTest {
        val release = CompletableDeferred<Unit>()
        withViewModel { viewModel ->
            try {
                viewModel.login("reader@example.com", "password", DEFAULT_API_BASE_URL)
                coEvery { repository.registrationStatus() } coAnswers {
                    withContext(NonCancellable) { release.await() }
                    AppResult.Success(RegistrationStatusResponse(true))
                }
                viewModel.logout()
                assertFalse(viewModel.state.value.isAuthenticated)
                assertNull(viewModel.state.value.user)
                viewModel.login("next@example.com", "password", "next.example")
                release.complete(Unit)
                runCurrent()
                assertTrue(viewModel.state.value.isAuthenticated)
                assertEquals("next.example", viewModel.state.value.apiBaseUrl)
            } finally { release.complete(Unit) }
        }
    }

    @Test
    fun `delayed password response cannot restore user after logout`() = runTest {
        val release = CompletableDeferred<Unit>()
        coEvery { repository.changePassword(any(), any()) } coAnswers {
            withContext(NonCancellable) { release.await() }
            AppResult.Success(sampleUser())
        }
        withViewModel { viewModel ->
            try {
                viewModel.login("reader@example.com", "password", DEFAULT_API_BASE_URL)
                viewModel.changePassword("password", "next-password")
                viewModel.logout()
                release.complete(Unit)
                runCurrent()
                assertNull(viewModel.state.value.user)
                assertFalse(viewModel.state.value.passwordChangePending)
                assertNull(viewModel.state.value.statusMessage)
            } finally { release.complete(Unit) }
        }
    }

    @Test
    fun `new login supersedes server switch waiting for logout`() = runTest {
        val release = CompletableDeferred<Unit>()
        coEvery { repository.logout() } coAnswers {
            withContext(NonCancellable) { release.await() }
            AppResult.Success(true)
        }
        withViewModel { viewModel ->
            try {
                viewModel.switchServerForExternalAction("old.example")
                viewModel.login("reader@example.com", "password", "new.example")
                release.complete(Unit)
                runCurrent()
                coVerify(exactly = 0) { repository.setApiBaseUrl("old.example") }
                assertTrue(viewModel.state.value.isAuthenticated)
                assertEquals("new.example", viewModel.state.value.apiBaseUrl)
            } finally { release.complete(Unit) }
        }
    }

    @Test
    fun `recreated route bootstrap does not restart authentication or cancel password change`() = runTest {
        val release = CompletableDeferred<Unit>()
        coEvery { repository.changePassword(any(), any()) } coAnswers {
            release.await()
            AppResult.Success(sampleUser())
        }
        withViewModel { viewModel ->
            try {
                viewModel.bootstrap()
                viewModel.login("reader@example.com", "password", DEFAULT_API_BASE_URL)
                viewModel.changePassword("password", "next-password")
                viewModel.bootstrap()
                release.complete(Unit)
                runCurrent()
                assertTrue(viewModel.state.value.isAuthenticated)
                assertFalse(viewModel.state.value.passwordChangePending)
                assertEquals(1L, viewModel.state.value.passwordChangeGeneration)
                coVerify(exactly = 1) { repository.registrationStatus() }
            } finally { release.complete(Unit) }
        }
    }

    @Test
    fun `password changes are rejected without an authenticated account`() = runTest {
        withViewModel { viewModel ->
            viewModel.changePassword("password", "next-password")
            coVerify(exactly = 0) { repository.changePassword(any(), any()) }
            assertFalse(viewModel.state.value.passwordChangePending)
        }
    }

    @Test
    fun `clearing an auth error preserves the eventual registration status`() = runTest {
        val events = kotlinx.coroutines.flow.MutableSharedFlow<String>()
        every { repository.authEvents() } returns events
        val release = CompletableDeferred<Unit>()
        coEvery { repository.registrationStatus() } coAnswers {
            release.await()
            AppResult.Success(RegistrationStatusResponse(true))
        }
        withViewModel { viewModel ->
            try {
                events.emit("Expired")
                viewModel.setAuthMode(AuthMode.LOGIN)
                release.complete(Unit)
                runCurrent()
                assertNull(viewModel.state.value.errorMessage)
                assertTrue(viewModel.state.value.registrationEnabled)
            } finally { release.complete(Unit) }
        }
    }

    private suspend fun withViewModel(block: suspend (AuthViewModel) -> Unit) {
        val viewModel = AuthViewModel(repository)
        val owner = ViewModelStore().apply { put("auth", viewModel) }
        try { block(viewModel) } finally { owner.clear() }
    }

    private fun verifiedSession() = AuthenticatedSession.Verified(
        ApiSession(0, configuredServer, "test-owner"), sampleUser(),
    )

    private fun sampleUser(): User = User(
        id = "user-1",
        email = "reader@example.com",
        role = "reader",
        isActive = true,
    )

    private companion object {
        const val DEFAULT_API_BASE_URL = "10.0.2.2:3000"
    }
}
