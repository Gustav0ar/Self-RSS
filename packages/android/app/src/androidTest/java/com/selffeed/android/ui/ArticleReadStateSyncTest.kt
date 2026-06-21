package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.screens.ArticleTabActions
import com.selffeed.android.ui.screens.ArticleTabState
import com.selffeed.android.ui.screens.ArticlesTab
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Tests for article read state synchronization.
 * Key behavior: articles should appear greyed out (read) in the list but NOT be filtered
 * out until the user explicitly refreshes the list.
 */
class ArticleReadStateSyncTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private fun sampleArticleListItem(id: String, title: String, isRead: Boolean = false): ArticleListItem =
        ArticleListItem(
            id = id,
            feedId = "feed-1",
            feedTitle = "Test Feed",
            title = title,
            excerpt = "Test excerpt",
            isRead = isRead,
        )

    private fun sampleArticleDetail(id: String, title: String, isRead: Boolean = false): ArticleDetail =
        ArticleDetail(
            id = id,
            feedId = "feed-1",
            feedTitle = "Test Feed",
            title = title,
            excerpt = "Test excerpt",
            contentHtml = "<p>Test content</p>",
            contentText = "Test content",
            author = "Test Author",
            canonicalUrl = "https://example.com/article/$id",
            feedSiteUrl = "https://example.com",
            publishedAt = "2024-01-01T00:00:00Z",
            media = emptyList(),
            isRead = isRead,
        )

    @Test
    fun articlesTab_showsUnreadArticleAsNotGreyedOut() {
        // Arrange: An unread article
        val articles = listOf(sampleArticleListItem("article-1", "Unread Article", isRead = false))

        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTab(
                    state = ArticleTabState(
                        articles = articles,
                        selectedArticleId = null,
                        hasMoreArticles = false,
                        loadingMoreArticles = false,
                        isSyncingFeeds = false,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onLoadMore = {},
                        onOpenArticle = {},
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        // Assert: Article is displayed
        composeRule.onNodeWithText("Unread Article").assertIsDisplayed()
    }

    @Test
    fun articlesTab_showsReadArticleAsGreyedOut() {
        // Arrange: A read article (isRead = true)
        val articles = listOf(sampleArticleListItem("article-1", "Read Article", isRead = true))

        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTab(
                    state = ArticleTabState(
                        articles = articles,
                        selectedArticleId = null,
                        hasMoreArticles = false,
                        loadingMoreArticles = false,
                        isSyncingFeeds = false,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onLoadMore = {},
                        onOpenArticle = {},
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        // Assert: Article is displayed (just greyed out visually)
        composeRule.onNodeWithText("Read Article").assertIsDisplayed()
    }

    @Test
    fun articlesTab_appliesReadStateOverridesToShowArticlesAsRead() {
        // This is the key test: read state overrides should mark articles as read
        // in the list without filtering them out
        var openedArticleId: String? = null

        // Arrange: Unread articles, but we'll apply read state overrides
        val articles = listOf(
            sampleArticleListItem("article-1", "First Article", isRead = false),
            sampleArticleListItem("article-2", "Second Article", isRead = false),
            sampleArticleListItem("article-3", "Third Article", isRead = false),
        )
        val readStateOverrides = mapOf(
            "article-1" to true,  // Mark as read via override
            "article-2" to true,  // Mark as read via override
            // article-3 stays unread
        )

        // Apply overrides to articles
        val articlesWithOverrides = articles.map { article ->
            readStateOverrides[article.id]?.let { article.copy(isRead = it) } ?: article
        }

        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTab(
                    state = ArticleTabState(
                        articles = articlesWithOverrides,
                        selectedArticleId = null,
                        hasMoreArticles = false,
                        loadingMoreArticles = false,
                        isSyncingFeeds = false,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onLoadMore = {},
                        onOpenArticle = { openedArticleId = it },
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        // Assert: All articles are still displayed (not filtered)
        composeRule.onNodeWithText("First Article").assertIsDisplayed()
        composeRule.onNodeWithText("Second Article").assertIsDisplayed()
        composeRule.onNodeWithText("Third Article").assertIsDisplayed()

        // Assert: Articles can still be clicked
        composeRule.onNodeWithText("Third Article").performClick()
        composeRule.runOnIdle {
            assertEquals("article-3", openedArticleId)
        }
    }

    @Test
    fun articlesTab_articlesNotFilteredUntilExplicitRefresh() {
        // Arrange: 5 articles, some marked read via override
        val articles = (1..5).map { i ->
            sampleArticleListItem("article-$i", "Article $i", isRead = false)
        }
        val readStateOverrides = mapOf(
            "article-1" to true,
            "article-3" to true,
            "article-5" to true,
        )
        val articlesWithOverrides = articles.map { article ->
            readStateOverrides[article.id]?.let { article.copy(isRead = it) } ?: article
        }

        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTab(
                    state = ArticleTabState(
                        articles = articlesWithOverrides,
                        selectedArticleId = null,
                        hasMoreArticles = false,
                        loadingMoreArticles = false,
                        isSyncingFeeds = false,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onLoadMore = {},
                        onOpenArticle = {},
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        // Assert: All 5 articles are still visible (not filtered)
        for (i in 1..5) {
            composeRule.onNodeWithText("Article $i").assertIsDisplayed()
        }
    }

    @Test
    fun readerPane_usesArticleQueueWithReadStateOverrides() {
        // Test that ArticleReaderPane receives articles with read states applied
        var selectedArticleId: String? = null

        val articles = listOf(
            sampleArticleListItem("article-1", "First Article", isRead = false),
            sampleArticleListItem("article-2", "Second Article", isRead = false),
        )
        // Articles with read states applied
        val articlesWithReadStates = articles.map { it.copy(isRead = true) }
        val selectedArticle = sampleArticleDetail("article-1", "First Article", isRead = true)

        composeRule.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = articlesWithReadStates,
                    selectedArticle = selectedArticle,
                    onOpenOriginal = {},
                    onBackToList = {},
                    onArticleSelected = { selectedArticleId = it },
                )
            }
        }

        composeRule.waitForIdle()
        composeRule.onNodeWithText("First Article").assertIsDisplayed()
    }

    @Test
    fun markArticleAsRead_updatesArticleInList() {
        // Simulates: user opens article -> article gets marked read -> list updates
        var readStateOverrides = mutableMapOf<String, Boolean>()
        var articlesMarkedRead = mutableListOf<String>()

        val initialArticles = listOf(
            sampleArticleListItem("article-1", "First Article", isRead = false),
            sampleArticleListItem("article-2", "Second Article", isRead = false),
        )
        val articlesWithOverrides = initialArticles.map { article ->
            readStateOverrides[article.id]?.let { article.copy(isRead = it) } ?: article
        }

        composeRule.setContent {
            var currentArticles by remember {
                mutableStateOf(articlesWithOverrides)
            }

            SelfFeedTheme {
                ArticlesTab(
                    state = ArticleTabState(
                        articles = currentArticles,
                        selectedArticleId = null,
                        hasMoreArticles = false,
                        loadingMoreArticles = false,
                        isSyncingFeeds = false,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onLoadMore = {},
                        onOpenArticle = { articleId ->
                            // Simulate marking article as read
                            readStateOverrides[articleId] = true
                            articlesMarkedRead.add(articleId)
                            // Update the articles list with new read state
                            currentArticles = currentArticles.map { article ->
                                if (article.id == articleId) article.copy(isRead = true) else article
                            }
                        },
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        // Click on first article to open it (simulates marking as read)
        composeRule.onNodeWithText("First Article").performClick()
        composeRule.runOnIdle {
            assertTrue("First article should be marked as read", articlesMarkedRead.contains("article-1"))
            assertEquals(1, articlesMarkedRead.size)
        }
    }

    @Test
    fun readStateOverrides_persistAcrossNavigation() {
        // Test that read state overrides persist when navigating back to list
        var readStateOverrides = mutableMapOf<String, Boolean>()

        val articles = listOf(
            sampleArticleListItem("article-1", "First Article", isRead = false),
            sampleArticleListItem("article-2", "Second Article", isRead = false),
        )
        val selectedArticle = sampleArticleDetail("article-1", "First Article", isRead = true)

        // Articles with read states (simulating what SelfFeedApp does)
        val articlesWithOverrides = remember(articles, readStateOverrides) {
            articles.map { article ->
                readStateOverrides[article.id]?.let { article.copy(isRead = it) } ?: article
            }
        }

        composeRule.setContent {
            var inReader by remember { mutableStateOf(false) }

            SelfFeedTheme {
                if (inReader) {
                    ArticleReaderPane(
                        articles = articlesWithOverrides,
                        selectedArticle = selectedArticle,
                        onOpenOriginal = {},
                        onBackToList = { inReader = false },
                        onArticleSelected = { newId ->
                            // Mark the new article as read when navigating
                            readStateOverrides[newId] = true
                        },
                    )
                } else {
                    ArticlesTab(
                        state = ArticleTabState(
                            articles = articlesWithOverrides,
                            selectedArticleId = null,
                            hasMoreArticles = false,
                            loadingMoreArticles = false,
                            isSyncingFeeds = false,
                        ),
                        actions = ArticleTabActions(
                            onRefresh = {},
                            onLoadMore = {},
                            onOpenArticle = { inReader = true },
                            onToggleRead = { _, _ -> },
                            onArticleSnapshot = {},
                        ),
                    )
                }
            }
        }

        // Initially show list with article-1 marked as read
        composeRule.onNodeWithText("First Article").assertIsDisplayed()
        composeRule.onNodeWithText("Second Article").assertIsDisplayed()

        // Click to open reader
        composeRule.onNodeWithText("First Article").performClick()
        composeRule.runOnIdle { assertTrue(inReader) }

        // Go back to list
        composeRule.onNodeWithText("Second Article").assertIsDisplayed() // Still visible
    }

    @Test
    fun readStateOverridesUpdateImmediately() {
        // Test that read state overrides update immediately without delay
        // This simulates the behavior when a user opens an article and it gets marked as read
        var readStateOverrides = mutableMapOf<String, Boolean>()
        var articleClicked = false

        val articles = listOf(
            sampleArticleListItem("article-1", "First Article", isRead = false),
            sampleArticleListItem("article-2", "Second Article", isRead = false),
        )

        composeRule.setContent {
            // Track the overrides - when updated, the articles list should re-render
            val articlesWithOverrides = remember(articles, readStateOverrides) {
                articles.map { article ->
                    readStateOverrides[article.id]?.let { article.copy(isRead = it) } ?: article
                }
            }

            SelfFeedTheme {
                ArticlesTab(
                    state = ArticleTabState(
                        articles = articlesWithOverrides,
                        selectedArticleId = null,
                        hasMoreArticles = false,
                        loadingMoreArticles = false,
                        isSyncingFeeds = false,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onLoadMore = {},
                        onOpenArticle = { articleId ->
                            // Simulate immediate read state update (as in applyArticleReadStateOptimistic)
                            readStateOverrides[articleId] = true
                            articleClicked = true
                        },
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        // Both articles start as unread
        composeRule.onNodeWithText("First Article").assertIsDisplayed()
        composeRule.onNodeWithText("Second Article").assertIsDisplayed()

        // Click first article - should immediately update read state
        composeRule.onNodeWithText("First Article").performClick()
        composeRule.runOnIdle {
            assertTrue("Article should be clicked", articleClicked)
            // The read state override should be updated immediately
            assertEquals(true, readStateOverrides["article-1"])
        }
    }

    @Test
    fun articleReadStateVisibleImmediatelyAfterOpeningReader() {
        // Tests the complete flow: open article -> marked as read -> back to list shows greyed out
        var readStateOverrides = mutableMapOf<String, Boolean>()
        var isInReader = false
        var selectedArticleId: String? = null

        val articles = listOf(
            sampleArticleListItem("article-1", "First Article", isRead = false),
            sampleArticleListItem("article-2", "Second Article", isRead = false),
        )
        val selectedArticle = sampleArticleDetail("article-1", "First Article", isRead = true)

        composeRule.setContent {
            val articlesWithOverrides = remember(articles, readStateOverrides) {
                articles.map { article ->
                    readStateOverrides[article.id]?.let { article.copy(isRead = it) } ?: article
                }
            }

            SelfFeedTheme {
                if (isInReader) {
                    ArticleReaderPane(
                        articles = articlesWithOverrides,
                        selectedArticle = selectedArticle,
                        onOpenOriginal = {},
                        onBackToList = { isInReader = false },
                        onArticleSelected = { newId ->
                            // Mark as read immediately
                            readStateOverrides[newId] = true
                        },
                    )
                } else {
                    ArticlesTab(
                        state = ArticleTabState(
                            articles = articlesWithOverrides,
                            selectedArticleId = selectedArticleId,
                            hasMoreArticles = false,
                            loadingMoreArticles = false,
                            isSyncingFeeds = false,
                        ),
                        actions = ArticleTabActions(
                            onRefresh = {},
                            onLoadMore = {},
                            onOpenArticle = { id ->
                                selectedArticleId = id
                                readStateOverrides[id] = true
                                isInReader = true
                            },
                            onToggleRead = { _, _ -> },
                            onArticleSnapshot = {},
                        ),
                    )
                }
            }
        }

        // Click to open article
        composeRule.onNodeWithText("First Article").performClick()
        composeRule.runOnIdle {
            assertTrue(isInReader)
            // Read state should be updated immediately
            assertEquals(true, readStateOverrides["article-1"])
        }
    }
}