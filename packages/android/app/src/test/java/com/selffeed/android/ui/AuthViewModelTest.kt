package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.normalizeApiServerHost
import com.selffeed.android.network.RegistrationStatusResponse
import com.selffeed.android.network.User
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
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
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        every { repository.getApiBaseUrl() } returns DEFAULT_API_BASE_URL
        every { repository.isLoggedIn() } returns false
        every { repository.authEvents() } returns emptyFlow()
        coEvery { repository.setApiBaseUrl(any()) } answers {
            AppResult.Success(normalizeApiServerHost(firstArg()))
        }
        coEvery { repository.registrationStatus() } returns AppResult.Success(
            RegistrationStatusResponse(registrationEnabled = true),
        )
        coEvery { repository.login(any(), any()) } returns AppResult.Success(sampleUser())
        coEvery { repository.register(any(), any()) } returns AppResult.Success(sampleUser())
        coEvery { repository.restoreSession() } returns AppResult.Success(sampleUser())
        coEvery { repository.logout() } returns AppResult.Success(true)
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
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
        assertEquals("Authentication was lost. Please sign in again.", state.errorMessage)
        assertTrue(state.registrationEnabled)
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
        assertEquals("Welcome back", state.statusMessage)
        assertNull(state.errorMessage)
        assertEquals("10.0.22.22:3000", state.apiBaseUrl)
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
        assertEquals("Bad credentials", state.errorMessage)
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
        assertEquals("Enter a valid server URL.", state.errorMessage)
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
        assertEquals("Registration is currently closed", state.errorMessage)
        coVerify(exactly = 0) { repository.register(any(), any()) }
    }

    @Test
    fun `register success transitions to authenticated`() = runTest {
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.register("new@example.com", "password", DEFAULT_API_BASE_URL)
        val state = viewModel.state.value
        assertTrue(state.isAuthenticated)
        assertEquals("Account created", state.statusMessage)
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
        assertEquals("Registration is currently closed", state.errorMessage)
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
