package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasProgressBarRangeInfo
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.screens.ArticleTabActions
import com.selffeed.android.ui.screens.ArticleTabState
import com.selffeed.android.ui.screens.ArticlesTab
import com.selffeed.android.ui.screens.SearchTab
import com.selffeed.android.ui.screens.SearchTabActions
import com.selffeed.android.ui.screens.SearchTabState
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

class ArticlesTabUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Before
    fun showTestActivityWhileDeviceIsLocked() {
        composeRule.runOnUiThread {
            composeRule.activity.setShowWhenLocked(true)
            composeRule.activity.setTurnScreenOn(true)
        }
    }

    @Test
    fun articlesTab_showsRowsAndTriggersActions() {
        var openedArticleId: String? = null

        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTabWithStaticPaging(
                    state = ArticleTabState(
                        articles = listOf(sampleArticle("article-1", "Visible Article")),
                        selectedArticleId = null,
                        isSyncingFeeds = false,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onOpenArticle = { openedArticleId = it },
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        composeRule.onNodeWithText("Visible Article").assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertEquals("article-1", openedArticleId)
        }
    }

    @Test
	fun articlesTab_openingArticleClearsPreviousSelection() {
        var openedArticleId: String? = null

        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTabWithStaticPaging(
                    state = ArticleTabState(
                        articles = listOf(
                            sampleArticle("article-1", "First Article"),
                            sampleArticle("article-2", "Second Article"),
                        ),
                        selectedArticleId = "article-1",
                        isSyncingFeeds = false,
                    ),
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onOpenArticle = { openedArticleId = it },
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
	}

	@Test
	fun articlesTab_opensVisibleArticleWithItsReaderQueueAtomically() {
		var openedArticleId: String? = null
		var openedQueue: List<ArticleListItem> = emptyList()
		val article = sampleArticle("article-1", "Visible Article")

		composeRule.setContent {
			SelfFeedTheme {
				ArticlesTabWithStaticPaging(
					state = ArticleTabState(
						articles = listOf(article),
						selectedArticleId = null,
						isSyncingFeeds = false,
					),
					actions = noOpArticleActions().copy(
						onOpenArticleFromQueue = { id, queue ->
							openedArticleId = id
							openedQueue = queue
						},
					),
				)
			}
		}

		composeRule.onNodeWithText("Visible Article").performClick()
		composeRule.runOnIdle {
			assertEquals("article-1", openedArticleId)
			assertEquals(listOf("article-1"), openedQueue.map { it.id })
		}
	}
        }

        // Click on the second article
        composeRule.onNodeWithText("Second Article").assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertEquals("article-2", openedArticleId)
        }
    }

    @Test
    fun articlesTab_refreshIndicatorOverlaysRowsWithoutPersistentBanner() {
        var state by mutableStateOf(
            ArticleTabState(
                articles = listOf(sampleArticle("article-1", "Visible Article")),
                selectedArticleId = null,
                isSyncingFeeds = false,
            ),
        )

        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTabWithStaticPaging(
                    state = state,
                    actions = ArticleTabActions(
                        onRefresh = {},
                        onOpenArticle = {},
                        onToggleRead = { _, _ -> },
                        onArticleSnapshot = {},
                    ),
                )
            }
        }

        composeRule.onNodeWithText("Visible Article").assertIsDisplayed()
        val rowTopBeforeRefresh = composeRule
            .onNodeWithText("Visible Article")
            .fetchSemanticsNode()
            .boundsInRoot
            .top
        val listModifierNames = composeRule
            .onNodeWithTag("articles-list")
            .fetchSemanticsNode()
            .layoutInfo
            .getModifierInfo()
            .map { it.modifier::class.java.name }
        assertTrue(
            "The article list must not use a graphics-layer pull translation: $listModifierNames",
            // LazyColumn owns an internal GraphicsLayerElement for item
            // animation. A block-based layer here would be the custom pull
            // translation that previously moved the entire list downward.
            listModifierNames.none { it.contains("BlockGraphicsLayer") },
        )

        composeRule.runOnUiThread {
            state = state.copy(isStartingFeedSync = true)
        }
        composeRule.waitUntil(timeoutMillis = 5_000) {
            composeRule.onAllNodesWithTag("articles-refresh-indicator").fetchSemanticsNodes().size == 1
        }

        val rowTopDuringRefresh = composeRule
            .onNodeWithText("Visible Article")
            .fetchSemanticsNode()
            .boundsInRoot
            .top
        assertEquals(rowTopBeforeRefresh, rowTopDuringRefresh, 0.5f)
        composeRule
            .onAllNodes(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate))
            .assertCountEquals(1)
        composeRule
            .onNodeWithText("Refreshing feeds in the background. New articles will appear as they arrive.")
            .assertDoesNotExist()
    }

    @Test
    fun articlesTab_initialFeedSyncUsesOnlyTheTopIndicatorImmediately() {
        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTabWithStaticPaging(
                    state = ArticleTabState(
                        articles = emptyList(),
                        selectedArticleId = null,
                        isSyncingFeeds = false,
                        isStartingFeedSync = true,
                    ),
                    actions = noOpArticleActions(),
                )
            }
        }

        composeRule.onNodeWithTag("articles-refresh-indicator").assertIsDisplayed()
        composeRule
            .onAllNodes(hasProgressBarRangeInfo(ProgressBarRangeInfo.Indeterminate))
            .assertCountEquals(1)
        composeRule.onNodeWithText("Start by adding a feed").assertDoesNotExist()
    }

    @Test
    fun articlesTab_emptyPagingSnapshotNeverRendersRetainedStateRows() {
        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTabWithStaticPaging(
                    state = ArticleTabState(
                        articles = listOf(sampleArticle("stale-1", "Stale Article")),
                        selectedArticleId = null,
                        isSyncingFeeds = false,
                        feedCount = 1,
                    ),
                    actions = noOpArticleActions(),
                    pagingArticles = emptyList(),
                )
            }
        }

        composeRule.onNodeWithText("Stale Article").assertDoesNotExist()
    }

    @Test
    fun articlesTab_rendersTheNewPagingGenerationWithoutAListGesture() {
        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTabWithStaticPaging(
                    state = ArticleTabState(
                        articles = listOf(sampleArticle("stale-1", "Stale Article")),
                        selectedArticleId = null,
                        isSyncingFeeds = false,
                        feedCount = 1,
                    ),
                    actions = noOpArticleActions(),
                    pagingArticles = listOf(sampleArticle("fresh-1", "Fresh Article")),
                )
            }
        }

        composeRule.onNodeWithText("Fresh Article").assertIsDisplayed()
        composeRule.onNodeWithText("Stale Article").assertDoesNotExist()
    }

    @Test
    fun articlesTab_reportsTheActualVisibleArticlesWhenOfflineBannerIsPresent() {
        val visibleArticleIds = AtomicReference<List<String>>(emptyList())
        val articles = (1..8).map { index -> sampleArticle("article-$index", "Article $index") }

        composeRule.setContent {
            SelfFeedTheme {
                ArticlesTabWithStaticPaging(
                    state = ArticleTabState(
                        articles = articles,
                        selectedArticleId = null,
                        isSyncingFeeds = false,
                        isOffline = true,
                    ),
                    actions = noOpArticleActions().copy(
                        onVisibleArticles = { visible ->
                            visibleArticleIds.set(visible.map { it.id })
                        },
                    ),
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000) { visibleArticleIds.get().isNotEmpty() }
        assertEquals("article-1", visibleArticleIds.get().first())
        assertTrue(visibleArticleIds.get().size <= 4)
    }

    @Test
    fun articlesTab_keepsTopPositionWhenRefreshPrependsArticles() {
        val initialArticles = (1..40).map { index ->
            sampleArticle("old-$index", "Old Article $index")
        }
        var updateState: (ArticleTabState) -> Unit = {}

        composeRule.setContent {
            var state by remember {
                mutableStateOf(
                    ArticleTabState(
                        articles = initialArticles,
                        selectedArticleId = null,
                        isSyncingFeeds = false,
                    ),
                )
            }
            updateState = { state = it }

            SelfFeedTheme {
                ArticlesTabWithStaticPaging(
                    state = state,
                    actions = noOpArticleActions(),
                )
            }
        }

        composeRule.onNodeWithText("Old Article 1").assertIsDisplayed()

        // A Material progress indicator intentionally animates while syncing,
        // so waitForIdle() is not a valid synchronization primitive here.
        // Schedule the completed refresh directly and wait for the settled
        // non-animated state below.
        composeRule.runOnUiThread {
            updateState(
                ArticleTabState(
                    articles = listOf(sampleArticle("fresh-1", "Fresh Article")) + initialArticles,
                    selectedArticleId = null,
                    isSyncingFeeds = false,
                ),
            )
        }
        composeRule.waitForIdle()

        composeRule.onNodeWithText("Old Article 1").assertIsDisplayed()
    }

    private fun noOpArticleActions(): ArticleTabActions = ArticleTabActions(
        onRefresh = {},
        onOpenArticle = {},
        onToggleRead = { _, _ -> },
        onArticleSnapshot = {},
    )

    private fun sampleArticle(id: String, title: String): ArticleListItem = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Feed",
        title = title,
        excerpt = "Excerpt",
        isRead = false,
    )
}

class SearchTabUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun searchTab_opensArticleOnClick() {
        var openedArticleId: String? = null

        composeRule.setContent {
            SelfFeedTheme {
                SearchTab(
                    state = SearchTabState(
                        query = "test",
                        results = listOf(
                            ArticleListItem(
                                id = "search-article-1",
                                feedId = "feed-1",
                                feedTitle = "Test Feed",
                                title = "Search Result Article",
                                excerpt = "Found this",
                                isRead = false,
                            ),
                        ),
                        selectedArticleId = null,
                        hasMoreResults = false,
                        loadingResults = false,
                        loadingMoreResults = false,
                        currentCategoryAvailable = false,
                        currentCategoryOnly = false,
                        resultLimitReached = false,
                    ),
                    actions = SearchTabActions(
                        onQueryChanged = {},
                        onSearchRequested = {},
                        onOpenArticle = { openedArticleId = it },
                        onLoadMore = {},
                        onCurrentCategoryOnlyChanged = {},
                    ),
                )
            }
        }

        composeRule.onNodeWithText("Search Result Article").assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertEquals("search-article-1", openedArticleId)
        }
    }

    @Test
    fun searchTab_doesNotOpenArticleWhenNoResults() {
        var openedArticleId: String? = null

        composeRule.setContent {
            SelfFeedTheme {
                SearchTab(
                    state = SearchTabState(
                        query = "nonexistent",
                        results = emptyList(),
                        selectedArticleId = null,
                        hasMoreResults = false,
                        loadingResults = false,
                        loadingMoreResults = false,
                        currentCategoryAvailable = false,
                        currentCategoryOnly = false,
                        resultLimitReached = false,
                    ),
                    actions = SearchTabActions(
                        onQueryChanged = {},
                        onSearchRequested = {},
                        onOpenArticle = { openedArticleId = it },
                        onLoadMore = {},
                        onCurrentCategoryOnlyChanged = {},
                    ),
                )
            }
        }

        composeRule.waitForIdle()
        // No article to click, the callback should never have been called
        assertNull("No article should be opened when results are empty", openedArticleId)
    }
}
