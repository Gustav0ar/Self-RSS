package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.AppSettingsResponse
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.User
import com.selffeed.android.network.UserPreferences
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private lateinit var repository: RssRepository

    @Before
    fun setup() {
        repository = mockk()

        every { repository.isLoggedIn() } returns false
        every { repository.getDebugResilienceSnapshot() } returns emptyMap()
        every { repository.resetDebugResilienceMetrics() } just runs

        coEvery { repository.me() } returns AppResult.Success(sampleUser())
        coEvery { repository.categories() } returns AppResult.Success(emptyList())
        coEvery { repository.feeds(any()) } returns AppResult.Success(emptyList())
        coEvery {
            repository.articles(
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
            )
        } returns AppResult.Success(ApiListResponse(emptyList(), null, false))
        coEvery { repository.search(any(), any(), any()) } returns AppResult.Success(ApiListResponse(emptyList(), null, false))
        coEvery { repository.preferences() } returns AppResult.Success(samplePreferences())
        coEvery { repository.stats() } returns AppResult.Success(sampleStats())
        coEvery { repository.adminSettings() } returns AppResult.Success(AppSettingsResponse(registrationLocked = false))
        coEvery { repository.login(any(), any()) } returns AppResult.Success(sampleUser())
        coEvery { repository.register(any(), any()) } returns AppResult.Success(sampleUser())
        coEvery { repository.logout() } returns AppResult.Success(true)
    }

    @Test
    fun bootstrap_loggedOut_finishesWithoutLoading() = runTest {
        every { repository.isLoggedIn() } returns false

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.loading)
        assertFalse(state.isAuthenticated)
    }

    @Test
    fun bootstrap_loggedIn_loadsDashboardData() = runTest {
        every { repository.isLoggedIn() } returns true

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.isAuthenticated)
        assertEquals(sampleUser().email, state.user?.email)

        coVerify(exactly = 1) { repository.me() }
        coVerify(atLeast = 1) { repository.categories() }
        coVerify(atLeast = 1) { repository.feeds(any()) }
        coVerify(atLeast = 1) {
            repository.articles(
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
            )
        }
        coVerify(atLeast = 1) { repository.preferences() }
        coVerify(atLeast = 1) { repository.stats() }
        coVerify(atLeast = 1) { repository.adminSettings() }
    }

    @Test
    fun login_success_setsAuthenticatedAndRefreshes() = runTest {
        every { repository.isLoggedIn() } returns false
        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        viewModel.login("reader@example.com", "password123")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.isAuthenticated)
        assertEquals("reader@example.com", state.user?.email)
        assertEquals("Welcome back", state.statusMessage)

        coVerify(exactly = 1) { repository.login("reader@example.com", "password123") }
        coVerify(atLeast = 1) { repository.stats() }
    }

    @Test
    fun search_debouncesAndUsesLatestQuery_onlyOnce() = runTest {
        every { repository.isLoggedIn() } returns false
        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        coEvery { repository.search("self", any(), any()) } returns AppResult.Success(
            ApiListResponse(listOf(sampleArticle(id = "s1", title = "Result A")), null, false),
        )
        coEvery { repository.search("selffeed", any(), any()) } returns AppResult.Success(
            ApiListResponse(listOf(sampleArticle(id = "s2", title = "Result B")), null, false),
        )

        viewModel.updateSearchQuery("self")
        viewModel.search()
        viewModel.updateSearchQuery("selffeed")
        viewModel.search()

        advanceTimeBy(299)
        coVerify(exactly = 0) { repository.search(any(), any(), any()) }

        advanceTimeBy(1)
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.search("selffeed", any(), any()) }
        val state = viewModel.uiState.value
        assertEquals(1, state.searchResults.size)
        assertEquals("Result B", state.searchResults.first().title)
    }

    @Test
    fun loadMoreArticles_appendsAndStopsWhenCursorEnds() = runTest {
        every { repository.isLoggedIn() } returns false
        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        coEvery {
            repository.articles(any(), any(), any(), any(), 30, null)
        } returns AppResult.Success(
            ApiListResponse(
                data = listOf(sampleArticle(id = "a1", title = "Page 1")),
                cursor = "cursor-1",
                hasMore = true,
            ),
        )
        coEvery {
            repository.articles(any(), any(), any(), any(), 30, "cursor-1")
        } returns AppResult.Success(
            ApiListResponse(
                data = listOf(sampleArticle(id = "a2", title = "Page 2")),
                cursor = null,
                hasMore = false,
            ),
        )

        viewModel.loadArticles()
        advanceUntilIdle()
        viewModel.loadMoreArticles()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(2, state.articles.size)
        assertFalse(state.hasMoreArticles)

        viewModel.loadMoreArticles()
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.articles(any(), any(), any(), any(), 30, "cursor-1") }
    }

    @Test
    fun resetDebugMetrics_doesNotCrash() = runTest {
        every { repository.isLoggedIn() } returns false

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        viewModel.resetDebugResilienceMetrics()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.errorMessage == null)
    }

    private fun sampleUser(): User = User(
        id = "user-1",
        email = "reader@example.com",
        role = "reader",
        isActive = true,
        createdAt = "2026-01-01T00:00:00.000Z",
        updatedAt = "2026-01-01T00:00:00.000Z",
    )

    private fun samplePreferences(): UserPreferences = UserPreferences(
        userId = "user-1",
        theme = "system",
        fontFamily = "system-ui",
        textSize = 16,
        density = "comfortable",
        defaultSort = "latest",
        hideRead = false,
        keyboardShortcutsEnabled = true,
        autoMarkReadMode = "disabled",
        createdAt = "2026-01-01T00:00:00.000Z",
        updatedAt = "2026-01-01T00:00:00.000Z",
    )

    private fun sampleStats(): StatsResponse = StatsResponse(
        totalUnread = 10,
        totalRead = 20,
        totalFeeds = 3,
        totalCategories = 2,
        recentSyncRuns = emptyList(),
        dailyMetrics = emptyList(),
    )

    private fun sampleArticle(id: String, title: String): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Feed",
        feedFaviconUrl = null,
        title = title,
        author = null,
        excerpt = "Excerpt",
        heroImageUrl = null,
        publishedAt = null,
        isRead = false,
    )
}
