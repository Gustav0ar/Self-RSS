package com.selffeed.android.ui

import com.selffeed.android.BuildConfig
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.AppSettingsResponse
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.UpdateAppSettingsRequest
import com.selffeed.android.network.UpdatePreferencesRequest
import com.selffeed.android.network.UserPreferences
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {
    private lateinit var repository: RssRepository
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        coEvery { repository.preferences() } returns AppResult.Success(samplePreferences())
        coEvery { repository.updatePreferences(any()) } returns AppResult.Success(samplePreferences())
        coEvery { repository.stats() } returns AppResult.Success(StatsResponse(0, 0, 0, 0))
        coEvery { repository.adminSettings() } returns AppResult.Success(AppSettingsResponse(registrationLocked = false))
        coEvery { repository.updateAdminSettings(any()) } returns AppResult.Success(AppSettingsResponse(registrationLocked = true))
        every { repository.getDebugResilienceSnapshot() } returns emptyMap()
        every { repository.resetDebugResilienceMetrics() } returns Unit
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `loadPreferences stores the preferences`() = runTest {
        val viewModel = SettingsViewModel(repository)
        viewModel.loadPreferences()
        assertNotNull(viewModel.state.value.preferences)
    }

    @Test
    fun `loadPreferences migrates amoled to dark`() = runTest {
        // Build a fresh mock and configure it explicitly to return
        // amoled. This avoids the cross-test coEvery state that the
        // shared @Before-freshed `repository` mock carries.
        val freshRepo = mockk<RssRepository>(relaxed = true)
        coEvery { freshRepo.preferences() } returns AppResult.Success(samplePreferences(theme = "amoled"))
        coEvery { freshRepo.updatePreferences(any()) } returns AppResult.Success(samplePreferences(theme = "dark"))
        val viewModel = SettingsViewModel(freshRepo)
        viewModel.loadPreferences()
        kotlinx.coroutines.delay(50)
        assertEquals("dark", viewModel.state.value.preferences?.theme)
        coVerify { freshRepo.updatePreferences(UpdatePreferencesRequest(theme = "dark")) }
    }

    @Test
    fun `updateTheme normalizes amoled to dark`() = runTest {
        val viewModel = SettingsViewModel(repository)
        viewModel.updateTheme("amoled")
        coVerify { repository.updatePreferences(UpdatePreferencesRequest(theme = "dark")) }
    }

    @Test
    fun `updateTextSize clamps to 12-24`() = runTest {
        val viewModel = SettingsViewModel(repository)
        viewModel.updateTextSize(8) // below floor
        coVerify { repository.updatePreferences(UpdatePreferencesRequest(textSize = 12)) }
        viewModel.updateTextSize(50) // above ceiling
        coVerify { repository.updatePreferences(UpdatePreferencesRequest(textSize = 24)) }
    }

    @Test
    fun `loadStats populates stats and triggers debug snapshot`() = runTest {
        val viewModel = SettingsViewModel(repository)
        viewModel.loadStats()
        assertNotNull(viewModel.state.value.stats)
    }

    @Test
    fun `toggleRegistrationLock sends the new value`() = runTest {
        val viewModel = SettingsViewModel(repository)
        viewModel.toggleRegistrationLock(true)
        coVerify { repository.updateAdminSettings(true) }
        assertEquals(true, viewModel.state.value.adminRegistrationLocked)
    }

    @Test
    fun `clearMessages wipes both error and status`() = runTest {
        val viewModel = SettingsViewModel(repository)
        viewModel.clearMessages()
        assertNull(viewModel.state.value.errorMessage)
        assertNull(viewModel.state.value.statusMessage)
    }

    private fun samplePreferences(theme: String = "system"): UserPreferences = UserPreferences(
        theme = theme,
        fontFamily = "system-ui",
        textSize = 16,
        density = "comfortable",
        defaultSort = "latest",
        hideRead = false,
        keyboardShortcutsEnabled = true,
        autoMarkReadMode = "on_navigate",
    )
}
