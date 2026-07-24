package com.selffeed.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.core.app.ActivityScenario
import com.selffeed.android.MainActivity
import com.selffeed.android.data.FakeSelfFeedRepository
import com.selffeed.android.network.ArticleMedia
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import javax.inject.Inject

@HiltAndroidTest
class MainActivityHiltUiTest {
    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createEmptyComposeRule()

    @Inject
    lateinit var repository: FakeSelfFeedRepository

    private var scenario: ActivityScenario<MainActivity>? = null

    @Before
    fun setup() {
        hiltRule.inject()
    }

    @After
    fun closeActivity() {
        scenario?.close()
    }

    @Test
    fun mainActivity_rendersInjectedArticleList() {
        repository.reset(authenticated = true)
        launchActivity()

        composeRule.onNodeWithText("Injected Article").assertIsDisplayed()
    }

    @Test
    fun realtimeReconnectInvalidatesReadStateAndRefreshesEveryArticleSurface() {
        repository.reset(authenticated = true)
        launchActivity()
        waitForText("Injected Article")
        composeRule.waitUntil(timeoutMillis = 5_000) { repository.hasReadStateSubscriber() }
        val categoriesBefore = repository.categoryRequests
        val feedsBefore = repository.feedRequests
        val articlesBefore = repository.articlePagingRequests
        val statsBefore = repository.statsRequests

        assertTrue(repository.emitRealtimeConnected())

        composeRule.waitUntil(timeoutMillis = 5_000) {
            repository.readStateInvalidations > 0 &&
                repository.categoryRequests > categoriesBefore &&
                repository.feedRequests > feedsBefore &&
                repository.articlePagingRequests > articlesBefore &&
                repository.statsRequests > statsBefore
        }
        composeRule.onNodeWithText("Injected Article").assertIsDisplayed()
    }

    @Test
    fun settingsTabRetriesAStartupPreferencesFailureInsteadOfRenderingBlank() {
        repository.reset(authenticated = true, preferenceFailures = 2)
        launchActivity()
        waitForText("Injected Article")

        composeRule.onNodeWithContentDescription("Settings tab", useUnmergedTree = true).performClick()
        waitForText("Settings unavailable")
        composeRule.onNodeWithText("Retry").performClick()

        waitForText("Preferences")
        assertTrue(repository.preferenceRequests >= 3)
        composeRule.onNodeWithText("Preferences").assertIsDisplayed()
    }

    @Test
    fun readerAutoMarksReadAndRemovesRowFromUnreadOnlyList() {
        repository.reset(authenticated = true, hideRead = true)
        launchActivity()

        waitForText("Injected Article")
        composeRule.onNodeWithText("Injected Article").performClick()

        waitForContentDescription("Mark as unread")
        composeRule.onNodeWithContentDescription("Mark as unread").assertIsDisplayed()

        composeRule.onNodeWithContentDescription("Back to list").performClick()
        waitForContentDescription("Open feeds")
        composeRule.waitUntil(timeoutMillis = 5_000) {
            composeRule.onAllNodesWithText("Injected Article").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onAllNodesWithText("Injected Article").assertCountEquals(0)
    }

    @Test
    fun tappingArticleOpensReaderBeforeDetailFetchCompletes() {
        repository.reset(authenticated = true)
        repository.delayArticleDetailsBy(5_000L)
        launchActivity()

        waitForText("Injected Article 2")
        composeRule.onNodeWithText("Injected Article 2").performClick()

        waitForContentDescription("Back to list", timeoutMillis = 1_200)
        composeRule.onNodeWithText("Injected Article 2").assertIsDisplayed()
    }

    @Test
    fun articleDetailOpensInRichModeByDefault() {
        repository.reset(authenticated = true)
        repository.overrideArticleDetail(
            articleId = "article-1",
            contentHtml = "<p>Rich article body.</p>",
            contentText = "Rich article body.",
            media = emptyList(),
        )
        launchActivity()

        waitForText("Injected Article")
        composeRule.onNodeWithText("Injected Article").performClick()

        waitForText("Rich")
        composeRule.onNodeWithText("Rich").assertIsSelected()
    }

    @Test
    fun readerTextModeHidesArticleMedia() {
        val imageUrl = "https://example.com/article-image.jpg"
        repository.reset(authenticated = true)
        repository.overrideArticleDetail(
            articleId = "article-1",
            contentHtml = "<p>Text mode keeps this paragraph.</p><img src=\"$imageUrl\" />",
            contentText = "Text mode keeps this paragraph.",
            media = listOf(
                ArticleMedia(
                    id = "image-1",
                    articleId = "article-1",
                    type = "image",
                    provider = "unknown",
                    url = imageUrl,
                    position = 0,
                ),
            ),
        )
        launchActivity()

        waitForText("Injected Article")
        composeRule.onNodeWithText("Injected Article").performClick()
        waitForContentDescription("Back to list")
        composeRule.onNodeWithText("Text").performClick()

        waitForText("Text mode keeps this paragraph.")
        composeRule.onNodeWithText("Text mode keeps this paragraph.").assertIsDisplayed()
        composeRule.onNodeWithText("Media").assertDoesNotExist()
        composeRule.onAllNodesWithContentDescription("Article image").assertCountEquals(0)
    }

    @Test
    fun readerSwipeNavigatesToNextArticleInUnreadOnlyMode() {
        repository.reset(authenticated = true, hideRead = true)
        launchActivity()

        waitForText("Injected Article")
        waitForText("Injected Article 2")
        composeRule.onNodeWithText("Injected Article").performClick()
        waitForContentDescription("Back to list")

        composeRule.onRoot().performTouchInput { swipeLeft() }

        waitForText("Injected Article 2")
        composeRule.onNodeWithText("Injected Article 2").assertIsDisplayed()
    }

    @Test
    fun loginFlow_acceptsHostOnlyServerAndOpensWorkspace() {
        repository.reset(authenticated = false)
        launchActivity()

        composeRule.onNodeWithText("Server").performTextClearance()
        composeRule.onNodeWithText("Server").performTextInput("10.0.22.22:3000")
        composeRule.onNodeWithText("Email").performTextInput("reader@example.com")
        composeRule.onNodeWithText("Password").performTextInput("password123")
        composeRule.onNodeWithText("Password").performImeAction()

        composeRule.waitUntil(timeoutMillis = 5_000) {
            repository.getApiBaseUrl() == "10.0.22.22:3000"
        }
        composeRule.onNodeWithText("Injected Article").assertIsDisplayed()
    }

    private fun launchActivity() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    private fun waitForText(text: String, timeoutMillis: Long = 5_000) {
        composeRule.waitUntil(timeoutMillis = timeoutMillis) {
            runCatching {
                composeRule.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
            }.getOrDefault(false)
        }
    }

    private fun waitForContentDescription(contentDescription: String, timeoutMillis: Long = 5_000) {
        composeRule.waitUntil(timeoutMillis = timeoutMillis) {
            runCatching {
                composeRule.onAllNodesWithContentDescription(contentDescription).fetchSemanticsNodes().isNotEmpty()
            }.getOrDefault(false)
        }
    }
}
