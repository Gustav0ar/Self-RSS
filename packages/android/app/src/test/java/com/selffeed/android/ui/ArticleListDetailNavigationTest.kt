package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ArticleListDetailNavigationTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun compactNavigationShowsDetailAndSystemBackClosesIt() {
        var readerClosed = false

        composeRule.setContent {
            var selectedArticleId by remember { mutableStateOf<String?>(null) }
            SelfFeedTheme {
                ArticleListDetailNavigation(
                    selectedArticleId = selectedArticleId,
                    onCloseArticle = {
                        readerClosed = true
                        selectedArticleId = null
                    },
                    listContent = { openReaderImmediately ->
                        Button(onClick = {
                            selectedArticleId = "article-1"
                            openReaderImmediately()
                        }) { Text("Open article") }
                    },
                    detailContent = { _, _ -> Text("Article detail") },
                )
            }
        }

        composeRule.onNodeWithText("Open article").performClick()
        composeRule.onNodeWithText("Article detail").assertIsDisplayed()

        composeRule.activity.onBackPressedDispatcher.onBackPressed()
        composeRule.waitUntil(timeoutMillis = 5_000) { readerClosed }
        assertTrue(readerClosed)
        composeRule.onNodeWithText("Open article").assertIsDisplayed()
    }

    @Test
    fun compactReaderBackRestoresTheHoistedListViewport() {
        composeRule.setContent {
            var selectedArticleId by remember { mutableStateOf<String?>(null) }
            val listState = rememberLazyListState(initialFirstVisibleItemIndex = 20)
            SelfFeedTheme {
                ArticleListDetailNavigation(
                    selectedArticleId = selectedArticleId,
                    onCloseArticle = { selectedArticleId = null },
                    listContent = { openReaderImmediately ->
                        LazyColumn(state = listState) {
                            items((0..40).toList()) { index ->
                                if (index == 20) {
                                    Button(
                                        onClick = {
                                            selectedArticleId = "article-20"
                                            openReaderImmediately()
                                        },
                                    ) { Text("Open item 20") }
                                } else {
                                    Text("List item $index")
                                }
                            }
                        }
                    },
                    detailContent = { _, _ -> Text("Article 20 detail") },
                )
            }
        }

        composeRule.onNodeWithText("Open item 20").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("Article 20 detail").assertIsDisplayed()
        composeRule.activity.onBackPressedDispatcher.onBackPressed()
        composeRule.onNodeWithText("Open item 20").assertIsDisplayed()
    }

    @Test
    fun articlesOpenInRichModeEvenBeforeHtmlHasLoaded() {
        composeRule.setContent {
            var selectedArticleId by remember { mutableStateOf<String?>("article-1") }
            SelfFeedTheme {
                ArticleListDetailNavigation(
                    selectedArticleId = selectedArticleId,
                    onCloseArticle = { selectedArticleId = null },
                    listContent = { Text("Article list") },
                    detailContent = { preferHtml, _ ->
                        Text(if (preferHtml) "Rich mode" else "Text mode")
                        Button(onClick = { selectedArticleId = "article-2" }) {
                            Text("Next article")
                        }
                    },
                )
            }
        }

        composeRule.onNodeWithText("Rich mode").assertIsDisplayed()
        composeRule.onNodeWithText("Next article").performClick()
        composeRule.onNodeWithText("Rich mode").assertIsDisplayed()
    }

    @Test
    fun manuallySelectedTextModeSurvivesChangingTheSelectedArticle() {
        var selectedArticleId by mutableStateOf<String?>("article-1")
        lateinit var changeMode: (Boolean) -> Unit
        composeRule.setContent {
            SelfFeedTheme {
                ArticleListDetailNavigation(
                    selectedArticleId = selectedArticleId,
                    onCloseArticle = { selectedArticleId = null },
                    listContent = { Text("Article list") },
                    detailContent = { preferHtml, onPreferHtmlChanged ->
                        changeMode = onPreferHtmlChanged
                        Text(if (preferHtml) "Rich mode" else "Text mode")
                    },
                )
            }
        }

        composeRule.onNodeWithText("Rich mode").assertIsDisplayed()
        composeRule.runOnIdle { changeMode(false) }
        composeRule.onNodeWithText("Text mode").assertIsDisplayed()
        composeRule.runOnIdle { selectedArticleId = "article-2" }
        composeRule.onNodeWithText("Text mode").assertIsDisplayed()
    }

    @Test
    fun aNewReaderSessionResetsManualTextModeBackToRich() {
        var selectedArticleId by mutableStateOf<String?>("article-1")
        lateinit var changeMode: (Boolean) -> Unit
        composeRule.setContent {
            SelfFeedTheme {
                ArticleListDetailNavigation(
                    selectedArticleId = selectedArticleId,
                    onCloseArticle = { selectedArticleId = null },
                    listContent = { Text("Article list") },
                    detailContent = { preferHtml, onPreferHtmlChanged ->
                        changeMode = onPreferHtmlChanged
                        Text(if (preferHtml) "Rich mode" else "Text mode")
                    },
                )
            }
        }

        composeRule.runOnIdle { changeMode(false) }
        composeRule.onNodeWithText("Text mode").assertIsDisplayed()
        composeRule.runOnIdle { selectedArticleId = null }
        composeRule.onNodeWithText("Article list").assertIsDisplayed()
        composeRule.runOnIdle { selectedArticleId = "article-2" }
        composeRule.onNodeWithText("Rich mode").assertIsDisplayed()
    }

    @Test
    fun swipingToNextArticleDoesNotRecreateTheReaderNavigationEntry() {
        val articles = listOf(
            article("article-1", "First Article"),
            article("article-2", "Second Article"),
            article("article-3", "Third Article"),
        )
        val details = articles.associate { it.id to detail(it) }
        var readerCompositions = 0
        var readerDisposals = 0
        var selectedArticle by mutableStateOf(details.getValue("article-1"))

        composeRule.setContent {
            SelfFeedTheme {
                ArticleListDetailNavigation(
                    selectedArticleId = selectedArticle.id,
                    onCloseArticle = {},
                    listContent = { Text("Article list") },
                    detailContent = { preferHtml, onPreferHtmlChanged ->
                        DisposableEffect(Unit) {
                            readerCompositions += 1
                            onDispose { readerDisposals += 1 }
                        }
                        ArticleReaderPane(
                            articles = articles,
                            selectedArticle = selectedArticle,
                            prefetchedArticles = details,
                            onOpenOriginal = {},
                            onBackToList = {},
                            onArticleSelected = { id -> selectedArticle = details.getValue(id) },
                            preferHtml = preferHtml,
                            onPreferHtmlChanged = onPreferHtmlChanged,
                        )
                    },
                )
            }
        }

        composeRule.onNodeWithText("First Article").assertIsDisplayed()
        composeRule.onRoot().performTouchInput { swipeLeft() }
        composeRule.waitUntil(timeoutMillis = 5_000) { selectedArticle.id == "article-2" }
        composeRule.onNodeWithText("Second Article").assertIsDisplayed()
        composeRule.runOnIdle {
            assertEquals(1, readerCompositions)
            assertEquals(0, readerDisposals)
        }
    }

    @Test
    fun listTapStartsReaderNavigationWithoutWaitingForPublishedArticleState() {
        composeRule.setContent {
            SelfFeedTheme {
                ArticleListDetailNavigation(
                    selectedArticleId = null,
                    onCloseArticle = {},
                    listContent = { openReaderImmediately ->
                        Button(onClick = openReaderImmediately) { Text("Open immediately") }
                    },
                    detailContent = { _, _ -> Text("Reader transition started") },
                )
            }
        }

        composeRule.onNodeWithText("Open immediately").performClick()

        composeRule.onNodeWithText("Reader transition started").assertIsDisplayed()
    }

    private fun article(id: String, title: String) = ArticleListItem(
        id = id,
        feedId = "feed-1",
        feedTitle = "Test Feed",
        title = title,
        excerpt = "Excerpt for $title",
        isRead = false,
    )

    private fun detail(article: ArticleListItem) = ArticleDetail(
        id = article.id,
        feedId = article.feedId,
        guid = article.id,
        title = article.title,
        excerpt = article.excerpt,
        contentText = "Complete body for ${article.title}",
        hash = "hash-${article.id}",
        feedTitle = article.feedTitle,
        isRead = false,
    )
}
