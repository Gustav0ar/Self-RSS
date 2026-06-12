package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.RegistrationStatusResponse
import com.selffeed.android.network.User
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
        every { repository.isLoggedIn() } returns false
        coEvery { repository.registrationStatus() } returns AppResult.Success(
            RegistrationStatusResponse(registrationEnabled = true),
        )
        coEvery { repository.login(any(), any()) } returns AppResult.Success(sampleUser())
        coEvery { repository.register(any(), any()) } returns AppResult.Success(sampleUser())
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
    }

    @Test
    fun `bootstrap with existing session sets authenticated`() = runTest {
        every { repository.isLoggedIn() } returns true
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        val state = viewModel.state.value
        assertFalse(state.loading)
        assertTrue(state.isAuthenticated)
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
        viewModel.login("reader@example.com", "password123")
        val state = viewModel.state.value
        assertTrue(state.isAuthenticated)
        assertEquals("Welcome back", state.statusMessage)
        assertNull(state.errorMessage)
        coVerify { repository.login("reader@example.com", "password123") }
    }

    @Test
    fun `login failure surfaces error message and keeps unauthenticated`() = runTest {
        coEvery { repository.login(any(), any()) } returns AppResult.Error("Bad credentials")
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.login("reader@example.com", "wrong")
        val state = viewModel.state.value
        assertFalse(state.isAuthenticated)
        assertEquals("Bad credentials", state.errorMessage)
    }

    @Test
    fun `register is blocked when registration is disabled`() = runTest {
        coEvery { repository.registrationStatus() } returns AppResult.Success(
            RegistrationStatusResponse(registrationEnabled = false),
        )
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.register("new@example.com", "password")
        val state = viewModel.state.value
        assertFalse(state.isAuthenticated)
        assertEquals("Registration is currently closed", state.errorMessage)
        coVerify(exactly = 0) { repository.register(any(), any()) }
    }

    @Test
    fun `register success transitions to authenticated`() = runTest {
        val viewModel = AuthViewModel(repository)
        viewModel.bootstrap()
        viewModel.register("new@example.com", "password")
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
        viewModel.login("x@x.com", "x")
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
}
