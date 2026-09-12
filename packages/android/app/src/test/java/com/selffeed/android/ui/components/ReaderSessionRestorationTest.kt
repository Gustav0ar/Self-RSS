package com.selffeed.android.ui.components

import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.onAllNodesWithTag
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.ui.ArticleListDetailNavigation
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ReaderSessionRestorationTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `reader scroll survives recreation while authentication and Room delay navigation composition`() {
        val tester = StateRestorationTester(composeRule)
        var initialProcess = true
        var cacheReady by mutableStateOf(false)
        val detail = ArticleDetail(
            id = "restored", feedId = "feed", guid = "restored", title = "Restored article",
            contentText = (1..100).joinToString("\n\n") { "Paragraph $it. This article is long enough to scroll." },
            hash = "body", feedTitle = "Feed", isRead = true, fetchedAt = "2026-09-07T12:00:00Z",
        )
        tester.setContent {
            SelfFeedTheme {
                if (initialProcess || cacheReady) {
                    ArticleListDetailNavigation(
                        selectedArticleId = detail.id,
                        onCloseArticle = {},
                        listContent = { Text("Article list") },
                        detailContent = { preferHtml, changeMode ->
                            ArticleReaderPane(
                                articles = emptyList(), selectedArticle = detail,
                                onOpenOriginal = {}, onBackToList = {}, onArticleSelected = {},
                                preferHtml = preferHtml, onPreferHtmlChanged = changeMode,
                            )
                        },
                    )
                } else Text("Loading")
            }
        }
        val scroll = SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
        composeRule.onNode(scroll).performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 600f) }
        val offset = composeRule.onNode(scroll).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertTrue(offset > 0f)

        // This plain flag changes only the newly-created composition. The
        // tester saves the currently open reader before disposing its tree.
        initialProcess = false
        tester.emulateSavedInstanceStateRestore()
        composeRule.onNode(scroll).assertDoesNotExist()
        composeRule.runOnIdle { cacheReady = true }
        val restoredOffset = composeRule.onNode(scroll).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertEquals(offset, restoredOffset, 1f)
    }
    @Test
    fun `rich restoration waits for measured body placement after visual readiness`() {
        val tester = StateRestorationTester(composeRule)
        var readyCount = 0
        val article = ArticleDetail(
            id = "rich-restore", feedId = "feed", guid = "rich", title = "Rich body",
            contentHtml = "<p>A long rich body measured by the renderer.</p>",
            hash = "body", feedTitle = "Feed", isRead = true,
        )
        tester.setContent {
            SelfFeedTheme {
                ArticleReaderPane(
                    articles = emptyList(), selectedArticle = article, preferHtml = true,
                    onOpenOriginal = {}, onBackToList = {}, onArticleSelected = {},
                    onArticleBodyReady = { readyCount++ },
                )
            }
        }
        fun readers(): List<ReaderWebView> = composeRule.runOnIdle {
            fun find(view: View): List<ReaderWebView> = buildList {
                if (view is ReaderWebView) add(view)
                if (view is ViewGroup) for (index in 0 until view.childCount) addAll(find(view.getChildAt(index)))
            }
            find(composeRule.activity.window.decorView)
        }
        composeRule.waitUntil(5_000) { readers().size == 1 }
        val first = readers().single()
        composeRule.runOnIdle { first.onHeight(5_000); first.onReady() }
        composeRule.waitForIdle()
        val scroll = SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
        composeRule.onNode(scroll).performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 1_500f) }
        val offset = composeRule.onNode(scroll).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertEquals(1_500f, offset, 1f)
        val previousReadyCount = readyCount
        tester.emulateSavedInstanceStateRestore()
        composeRule.waitUntil(5_000) { readers().singleOrNull()?.let { it !== first } == true }
        val restoredReader = readers().single()
        // Chromium's visual callback and posted JS height can arrive in either order.
        composeRule.runOnIdle { restoredReader.onReady() }
        composeRule.waitForIdle()
        assertEquals("Visual readiness alone cannot restore against the placeholder height", previousReadyCount, readyCount)
        composeRule.runOnIdle { restoredReader.onHeight(5_000) }
        composeRule.waitForIdle()
        assertEquals(previousReadyCount + 1, readyCount)
        val restored = composeRule.onNode(scroll).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertEquals(offset, restored, 1f)
    }

    @Test
    fun `delayed preparation cannot record reading completion before the body appears`() {
        val gate = ReaderPreparationGate().apply { pause() }
        val preparer = ReaderContentPreparer(gate)
        val completions = mutableListOf<String>()
        val article = ArticleDetail(
            id = "pending", feedId = "feed", guid = "pending", title = "Pending body",
            contentText = "Short readable body.", hash = "body", feedTitle = "Feed", isRead = true,
        )
        composeRule.setContent {
            CompositionLocalProvider(LocalReaderContentPreparer provides preparer) {
                SelfFeedTheme {
                    ArticleReaderPane(
                        articles = emptyList(), selectedArticle = article, preferHtml = false,
                        onOpenOriginal = {}, onBackToList = {}, onArticleSelected = {},
                        onArticleCompleted = { completions += it },
                    )
                }
            }
        }
        try {
            composeRule.waitUntil(5_000) { gate.pendingCount == 1 }
            composeRule.mainClock.advanceTimeBy(6_000)
            composeRule.runOnIdle { assertTrue("An unprepared body cannot be completed", completions.isEmpty()) }
            gate.release()
            composeRule.waitUntil(5_000) {
                composeRule.onAllNodesWithTag("reader-text-content").fetchSemanticsNodes().isNotEmpty()
            }
            composeRule.mainClock.advanceTimeBy(6_000)
            composeRule.runOnIdle { assertEquals(listOf(article.id), completions) }
        } finally { gate.release() }
    }

    @Test
    fun `restored text scroll survives delayed content preparation`() {
        val tester = StateRestorationTester(composeRule)
        val dispatcher = ReaderPreparationGate()
        val preparer = ReaderContentPreparer(dispatcher)
        val article = ArticleDetail(
            id = "delayed-restore", feedId = "feed", guid = "delayed", title = "Delayed reader",
            contentText = (1..100).joinToString("\n\n") { "Paragraph $it. Long enough to restore the exact reading position." },
            hash = "body", feedTitle = "Feed", isRead = true,
        )
        tester.setContent {
            CompositionLocalProvider(LocalReaderContentPreparer provides preparer) {
                SelfFeedTheme {
                    ArticleReaderPane(
                        articles = emptyList(), selectedArticle = article, preferHtml = false,
                        onOpenOriginal = {}, onBackToList = {}, onArticleSelected = {},
                    )
                }
            }
        }
        val scroll = SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
        fun waitForText() = composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithTag("reader-text-content").fetchSemanticsNodes().isNotEmpty()
        }
        waitForText()
        composeRule.onNode(scroll).performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 600f) }
        val offset = composeRule.onNode(scroll).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertTrue(offset > 0)
        dispatcher.pause()
        try {
            tester.emulateSavedInstanceStateRestore()
            composeRule.waitUntil(5_000) { dispatcher.pendingCount > 0 }
            // A second recreation must save the pending offset, not the empty layout.
            tester.emulateSavedInstanceStateRestore()
            composeRule.waitUntil(5_000) { dispatcher.pendingCount >= 2 }
            dispatcher.release()
            waitForText()
            composeRule.waitForIdle()
            val restored = composeRule.onNode(scroll).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
            assertEquals(offset, restored, 1f)
        } finally {
            dispatcher.release()
        }
    }

}
