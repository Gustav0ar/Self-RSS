package com.selffeed.android.ui

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.network.ApiListResponse
import com.selffeed.android.network.AppSettingsResponse
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleReadStateChangedEvent
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.ArticlesMarkedReadEvent
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.ReadStateScope
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.RegistrationStatusResponse
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.UpdatePreferencesRequest
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
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
    private lateinit var readStateEvents: MutableSharedFlow<ReadStateSyncEvent>

    @Before
    fun setup() {
        repository = mockk()
        readStateEvents = MutableSharedFlow(extraBufferCapacity = 16)

        every { repository.isLoggedIn() } returns false
        every { repository.clientId() } returns "android-client"
        every { repository.readStateEvents() } returns readStateEvents
        every { repository.invalidateReadStateCaches(any()) } just runs
        every { repository.invalidateReadStateCaches(null) } just runs
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
        coEvery { repository.registrationStatus() } returns AppResult.Success(RegistrationStatusResponse(registrationEnabled = true))
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
        assertTrue(state.registrationEnabled)
        coVerify(exactly = 1) { repository.registrationStatus() }
    }

    @Test
    fun bootstrap_loggedOut_disablesRegistrationWhenStatusUnavailable() = runTest {
        every { repository.isLoggedIn() } returns false
        coEvery { repository.registrationStatus() } returns AppResult.Error("status unavailable")

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.loading)
        assertFalse(state.isAuthenticated)
        assertFalse(state.registrationEnabled)
        assertEquals(AuthMode.LOGIN, state.authMode)
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
    fun register_disabled_doesNotCallRepository() = runTest {
        every { repository.isLoggedIn() } returns false
        coEvery { repository.registrationStatus() } returns AppResult.Success(
            RegistrationStatusResponse(registrationEnabled = false),
        )
        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        viewModel.setAuthMode(AuthMode.REGISTER)
        viewModel.register("reader@example.com", "password123")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.registrationEnabled)
        assertFalse(state.isAuthenticated)
        assertEquals(AuthMode.LOGIN, state.authMode)
        assertEquals("Registration is currently closed", state.errorMessage)
        coVerify(exactly = 0) { repository.register(any(), any()) }
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
    fun bootstrap_reloadsArticlesWhenHiddenReadPreferenceArrives() = runTest {
        every { repository.isLoggedIn() } returns true
        coEvery { repository.preferences() } returns AppResult.Success(samplePreferences(hideRead = true))
        coEvery {
            repository.articles(any(), any(), false, any(), any(), null)
        } coAnswers {
            delay(50)
            AppResult.Success(
                ApiListResponse(
                    listOf(sampleArticle(id = "read-article", title = "Read", isRead = true)),
                    null,
                    false,
                ),
            )
        }
        coEvery {
            repository.articles(any(), any(), true, "latest", any(), null)
        } returns AppResult.Success(
            ApiListResponse(
                listOf(sampleArticle(id = "unread-article", title = "Unread", isRead = false)),
                null,
                false,
            ),
        )

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.preferences?.hideRead == true)
        assertEquals(listOf("unread-article"), state.articles.map { it.id })
        assertTrue(state.articles.none { it.isRead })
        coVerify(atLeast = 1) { repository.articles(any(), any(), false, any(), any(), null) }
        coVerify(atLeast = 1) { repository.articles(any(), any(), true, "latest", any(), null) }
    }

    @Test
    fun readStateSync_remoteReadUpdatesLoadedState() = runTest {
        every { repository.isLoggedIn() } returns true
        coEvery { repository.feeds(any()) } returns AppResult.Success(
            listOf(sampleFeed(id = "feed-1", categoryId = "category-1", unreadCount = 2)),
        )
        coEvery { repository.categories() } returns AppResult.Success(
            listOf(sampleCategory(id = "category-1", unreadCount = 2)),
        )
        coEvery { repository.stats() } returns AppResult.Success(sampleStats(totalUnread = 10, totalRead = 20))
        coEvery {
            repository.articles(any(), any(), any(), any(), any(), any())
        } returns AppResult.Success(
            ApiListResponse(
                listOf(
                    sampleArticle(id = "a1", title = "Unread 1"),
                    sampleArticle(id = "a2", title = "Unread 2"),
                ),
                null,
                false,
            ),
        )

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        readStateEvents.emit(
            ArticleReadStateChangedEvent(
                eventId = "event-1",
                articleId = "a1",
                feedId = "feed-1",
                isRead = true,
                source = "manual",
                clientId = "web-client",
                updatedAt = "2026-06-01T00:00:00.000Z",
            ),
        )
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.articles.first { it.id == "a1" }.isRead)
        assertEquals(1, state.feeds.first { it.id == "feed-1" }.unreadCount)
        assertEquals(1, state.categories.first { it.id == "category-1" }.unreadCount)
        assertEquals(9, state.stats?.totalUnread)
        assertEquals(21, state.stats?.totalRead)
        verify { repository.invalidateReadStateCaches("a1") }
    }

    @Test
    fun openArticle_keepsReadArticleInHiddenReadListUntilRefresh() = runTest {
        every { repository.isLoggedIn() } returns true
        coEvery { repository.preferences() } returns AppResult.Success(samplePreferences(hideRead = true))
        coEvery {
            repository.articles(any(), any(), true, any(), any(), any())
        } returns AppResult.Success(
            ApiListResponse(listOf(sampleArticle(id = "a1", title = "Unread 1")), null, false),
        )
        coEvery { repository.article("a1", any()) } returns AppResult.Success(
            sampleArticleDetail(id = "a1", title = "Unread 1", isRead = false),
        )
        coEvery { repository.markRead("a1", true) } returns AppResult.Success(true)
        every { repository.invalidateArticleCaches("a1") } just runs

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        viewModel.openArticle("a1")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(listOf("a1"), state.articles.map { it.id })
        assertTrue(state.articles.first().isRead)
        assertTrue(state.selectedArticle?.isRead == true)
    }

    @Test
    fun readStateSync_ignoresEventsFromSameAndroidClient() = runTest {
        every { repository.isLoggedIn() } returns true
        coEvery { repository.feeds(any()) } returns AppResult.Success(
            listOf(sampleFeed(id = "feed-1", categoryId = "category-1", unreadCount = 2)),
        )
        coEvery { repository.categories() } returns AppResult.Success(
            listOf(sampleCategory(id = "category-1", unreadCount = 2)),
        )
        coEvery { repository.stats() } returns AppResult.Success(sampleStats(totalUnread = 10, totalRead = 20))
        coEvery {
            repository.articles(any(), any(), any(), any(), any(), any())
        } returns AppResult.Success(
            ApiListResponse(listOf(sampleArticle(id = "a1", title = "Unread 1")), null, false),
        )

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        readStateEvents.emit(
            ArticleReadStateChangedEvent(
                eventId = "event-1",
                articleId = "a1",
                feedId = "feed-1",
                isRead = true,
                source = "manual",
                clientId = "android-client",
                updatedAt = "2026-06-01T00:00:00.000Z",
            ),
        )
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.articles.first { it.id == "a1" }.isRead)
        assertEquals(2, state.feeds.first { it.id == "feed-1" }.unreadCount)
        verify(exactly = 0) { repository.invalidateReadStateCaches("a1") }
    }

    @Test
    fun readStateSync_remoteReadKeepsArticleInHiddenReadListUntilRefresh() = runTest {
        every { repository.isLoggedIn() } returns true
        coEvery { repository.preferences() } returns AppResult.Success(samplePreferences(hideRead = true))
        coEvery { repository.feeds(any()) } returns AppResult.Success(
            listOf(sampleFeed(id = "feed-1", categoryId = "category-1", unreadCount = 1)),
        )
        coEvery { repository.categories() } returns AppResult.Success(
            listOf(sampleCategory(id = "category-1", unreadCount = 1)),
        )
        coEvery {
            repository.articles(any(), any(), any(), any(), any(), any())
        } returns AppResult.Success(
            ApiListResponse(listOf(sampleArticle(id = "a1", title = "Unread 1")), null, false),
        )

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        readStateEvents.emit(
            ArticleReadStateChangedEvent(
                eventId = "event-1",
                articleId = "a1",
                feedId = "feed-1",
                isRead = true,
                source = "manual",
                clientId = "web-client",
                updatedAt = "2026-06-01T00:00:00.000Z",
            ),
        )
        advanceUntilIdle()

        val article = viewModel.uiState.value.articles.first { it.id == "a1" }
        assertTrue(article.isRead)
    }

    @Test
    fun readStateSync_remoteUnreadReloadsHiddenReadListWhenArticleIsMissing() = runTest {
        every { repository.isLoggedIn() } returns true
        coEvery { repository.preferences() } returns AppResult.Success(samplePreferences(hideRead = true))
        coEvery { repository.feeds(any()) } returns AppResult.Success(
            listOf(sampleFeed(id = "feed-1", categoryId = "category-1", unreadCount = 0)),
        )
        coEvery { repository.categories() } returns AppResult.Success(
            listOf(sampleCategory(id = "category-1", unreadCount = 0)),
        )
        coEvery {
            repository.articles(any(), any(), any(), any(), any(), any())
        } returns AppResult.Success(
            ApiListResponse(listOf(sampleArticle(id = "a2", title = "Other unread")), null, false),
        )

        MainViewModel(repository)
        advanceUntilIdle()

        readStateEvents.emit(
            ArticleReadStateChangedEvent(
                eventId = "event-1",
                articleId = "a1",
                feedId = "feed-1",
                isRead = false,
                source = "manual",
                clientId = "web-client",
                updatedAt = "2026-06-01T00:00:00.000Z",
            ),
        )
        advanceUntilIdle()

        coVerify(atLeast = 2) {
            repository.articles(any(), any(), any(), any(), any(), any())
        }
    }

    @Test
    fun readStateSync_markAllReadUpdatesVisibleState() = runTest {
        every { repository.isLoggedIn() } returns true
        coEvery { repository.feeds(any()) } returns AppResult.Success(
            listOf(
                sampleFeed(id = "feed-1", categoryId = "category-1", unreadCount = 3),
                sampleFeed(id = "feed-2", categoryId = "category-1", unreadCount = 2),
                sampleFeed(id = "feed-3", categoryId = "category-2", unreadCount = 4),
            ),
        )
        coEvery { repository.categories() } returns AppResult.Success(
            listOf(
                sampleCategory(id = "category-1", unreadCount = 5),
                sampleCategory(id = "category-2", unreadCount = 4),
            ),
        )
        coEvery { repository.stats() } returns AppResult.Success(sampleStats(totalUnread = 9, totalRead = 20))
        coEvery {
            repository.articles(any(), any(), any(), any(), any(), any())
        } returns AppResult.Success(
            ApiListResponse(
                listOf(
                    sampleArticle(id = "a1", title = "Feed 1", feedId = "feed-1"),
                    sampleArticle(id = "a2", title = "Feed 2", feedId = "feed-2"),
                    sampleArticle(id = "a3", title = "Feed 3", feedId = "feed-3"),
                ),
                null,
                false,
            ),
        )

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        readStateEvents.emit(
            ArticlesMarkedReadEvent(
                eventId = "event-1",
                feedIds = listOf("feed-1", "feed-2"),
                scope = ReadStateScope(),
                markedCount = 5,
                clientId = "web-client",
                updatedAt = "2026-06-01T00:00:00.000Z",
            ),
        )
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.articles.first { it.id == "a1" }.isRead)
        assertTrue(state.articles.first { it.id == "a2" }.isRead)
        assertFalse(state.articles.first { it.id == "a3" }.isRead)
        assertEquals(0, state.feeds.first { it.id == "feed-1" }.unreadCount)
        assertEquals(0, state.feeds.first { it.id == "feed-2" }.unreadCount)
        assertEquals(4, state.feeds.first { it.id == "feed-3" }.unreadCount)
        assertEquals(0, state.categories.first { it.id == "category-1" }.unreadCount)
        assertEquals(4, state.categories.first { it.id == "category-2" }.unreadCount)
        assertEquals(4, state.stats?.totalUnread)
        assertEquals(25, state.stats?.totalRead)
        verify { repository.invalidateReadStateCaches(null) }
    }

    @Test
    fun loadPreferences_migratesAmoledThemeToDark() = runTest {
        every { repository.isLoggedIn() } returns false
        coEvery { repository.preferences() } returns AppResult.Success(samplePreferences(theme = "amoled"))
        coEvery { repository.updatePreferences(UpdatePreferencesRequest(theme = "dark")) } returns AppResult.Success(
            samplePreferences(theme = "dark"),
        )

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        viewModel.loadPreferences()
        advanceUntilIdle()

        assertEquals("dark", viewModel.uiState.value.preferences?.theme)
        coVerify(exactly = 1) { repository.updatePreferences(UpdatePreferencesRequest(theme = "dark")) }
    }

    @Test
    fun updateTheme_normalizesAmoledToDark() = runTest {
        every { repository.isLoggedIn() } returns false
        coEvery { repository.updatePreferences(UpdatePreferencesRequest(theme = "dark")) } returns AppResult.Success(
            samplePreferences(theme = "dark"),
        )

        val viewModel = MainViewModel(repository)
        advanceUntilIdle()

        viewModel.updateTheme("amoled")
        advanceUntilIdle()

        assertEquals("dark", viewModel.uiState.value.preferences?.theme)
        coVerify(exactly = 1) { repository.updatePreferences(UpdatePreferencesRequest(theme = "dark")) }
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

    private fun samplePreferences(
        hideRead: Boolean = false,
        theme: String = "system",
    ): UserPreferences = UserPreferences(
        userId = "user-1",
        theme = theme,
        fontFamily = "system-ui",
        textSize = 16,
        density = "comfortable",
        defaultSort = "latest",
        hideRead = hideRead,
        keyboardShortcutsEnabled = true,
        autoMarkReadMode = "on_navigate",
        createdAt = "2026-01-01T00:00:00.000Z",
        updatedAt = "2026-01-01T00:00:00.000Z",
    )

    private fun sampleStats(totalUnread: Int = 10, totalRead: Int = 20): StatsResponse = StatsResponse(
        totalUnread = totalUnread,
        totalRead = totalRead,
        totalFeeds = 3,
        totalCategories = 2,
        recentSyncRuns = emptyList(),
        dailyMetrics = emptyList(),
    )

    private fun sampleFeed(id: String, categoryId: String, unreadCount: Int): FeedWithCounts = FeedWithCounts(
        id = id,
        categoryId = categoryId,
        title = "Feed $id",
        feedUrl = "https://example.com/$id.xml",
        pollingIntervalMinutes = 60,
        syncStatus = "idle",
        unreadCount = unreadCount,
    )

    private fun sampleCategory(id: String, unreadCount: Int): CategoryWithCounts = CategoryWithCounts(
        id = id,
        name = "Category $id",
        slug = id,
        sortOrder = 0,
        feedCount = 1,
        unreadCount = unreadCount,
    )

    private fun sampleArticle(
        id: String,
        title: String,
        feedId: String = "feed-1",
        isRead: Boolean = false,
    ): ArticleListItem = ArticleListItem(
        id = id,
        feedId = feedId,
        feedTitle = "Feed",
        feedFaviconUrl = null,
        title = title,
        author = null,
        excerpt = "Excerpt",
        heroImageUrl = null,
        publishedAt = null,
        isRead = isRead,
    )

    private fun sampleArticleDetail(
        id: String,
        title: String,
        feedId: String = "feed-1",
        isRead: Boolean = false,
    ): ArticleDetail = ArticleDetail(
        id = id,
        feedId = feedId,
        guid = id,
        canonicalUrl = null,
        title = title,
        author = null,
        excerpt = "Excerpt",
        contentHtml = null,
        contentText = "Content",
        heroImageUrl = null,
        publishedAt = null,
        fetchedAt = "2026-01-01T00:00:00.000Z",
        hash = id,
        feedTitle = "Feed",
        feedFaviconUrl = null,
        feedSiteUrl = null,
        media = emptyList(),
        isRead = isRead,
        isEnriched = false,
    )
}
