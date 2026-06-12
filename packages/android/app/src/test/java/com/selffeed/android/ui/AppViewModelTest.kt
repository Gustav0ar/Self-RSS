package com.selffeed.android.ui

import com.selffeed.android.data.RssRepository
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
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
class AppViewModelTest {
    private lateinit var repository: RssRepository
    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repository = mockk()
        every { repository.observeOnline() } returns MutableStateFlow(true)
        every { repository.isOnline() } returns true
    }

    @After
    fun teardown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `chrome defaults to ARTICLES tab and online`() = runTest {
        val viewModel = AppViewModel(repository)
        val chrome = viewModel.chrome.value
        assertEquals(HomeTab.ARTICLES, chrome.activeTab)
        assertTrue(chrome.isOnline)
        assertFalse(chrome.isSyncingFeeds)
        assertNull(chrome.globalError)
        assertNull(chrome.globalStatus)
    }

    @Test
    fun `setTab updates active tab and clears messages`() = runTest {
        val viewModel = AppViewModel(repository)
        viewModel.postError("oops")
        viewModel.postStatus("done")
        viewModel.setTab(HomeTab.SEARCH)
        val chrome = viewModel.chrome.value
        assertEquals(HomeTab.SEARCH, chrome.activeTab)
        assertNull(chrome.globalError)
        assertNull(chrome.globalStatus)
    }

    @Test
    fun `postError bumps the message and stores it`() = runTest {
        val viewModel = AppViewModel(repository)
        viewModel.postError("first")
        assertEquals("first", viewModel.chrome.value.globalError)
        viewModel.postError("second")
        assertEquals("second", viewModel.chrome.value.globalError)
    }

    @Test
    fun `postStatus null clears the message`() = runTest {
        val viewModel = AppViewModel(repository)
        viewModel.postStatus("hello")
        assertEquals("hello", viewModel.chrome.value.globalStatus)
        viewModel.postStatus(null)
        assertNull(viewModel.chrome.value.globalStatus)
    }

    @Test
    fun `setSyncingFeeds toggles the flag`() = runTest {
        val viewModel = AppViewModel(repository)
        viewModel.setSyncingFeeds(true)
        assertTrue(viewModel.chrome.value.isSyncingFeeds)
        viewModel.setSyncingFeeds(false)
        assertFalse(viewModel.chrome.value.isSyncingFeeds)
    }

    @Test
    fun `clearMessages wipes both error and status`() = runTest {
        val viewModel = AppViewModel(repository)
        viewModel.postError("err")
        viewModel.postStatus("ok")
        viewModel.clearMessages()
        val chrome = viewModel.chrome.value
        assertNull(chrome.globalError)
        assertNull(chrome.globalStatus)
    }

    @Test
    fun `isOnline exposes the initial value from the repository`() = runTest {
        val viewModel = AppViewModel(repository)
        // The stateIn initial is repository.isOnline() = true, so the flow
        // emits true immediately even without a collector.
        assertEquals(true, viewModel.isOnline.value)
    }

    @Test
    fun `isOnline reflects a flow that starts offline`() = runTest {
        every { repository.isOnline() } returns false
        every { repository.observeOnline() } returns MutableStateFlow(false)
        val viewModel = AppViewModel(repository)
        assertEquals(false, viewModel.isOnline.value)
    }
}
