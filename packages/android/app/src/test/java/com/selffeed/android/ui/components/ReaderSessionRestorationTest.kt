package com.selffeed.android.ui.components

import android.view.View
import android.view.ViewGroup
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
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
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ReaderSessionRestorationTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `reader effects return to Main after background preparation`() {
        val gate = ReaderPreparationGate().apply { pause() }
        val preparer = ReaderContentPreparer(gate)
        val resumedThread = AtomicReference<Thread>()
        composeRule.setContent {
            LaunchedEffect(Unit) {
                preparer.text(null, "Prepared article", null)
                resumedThread.set(Thread.currentThread())
            }
        }
        try {
            composeRule.waitUntil(5_000) { gate.pendingCount > 0 }
            gate.release()
            composeRule.waitUntil(5_000) {
                composeRule.runOnIdle { resumedThread.get() != null }
            }
            assertEquals(Looper.getMainLooper().thread, resumedThread.get())
        } finally { gate.release() }
    }

    @Test
    fun `reader scroll survives recreation while authentication and Room delay navigation composition`() {
        val tester = StateRestorationTester(composeRule)
        val gate = ReaderPreparationGate()
        val preparer = ReaderContentPreparer(gate)
        var bodyReadyCount = 0
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
                            CompositionLocalProvider(LocalReaderContentPreparer provides preparer) {
                                ArticleReaderPane(
                                    articles = emptyList(), selectedArticle = detail,
                                    onOpenOriginal = {}, onBackToList = {}, onArticleSelected = {},
                                    preferHtml = preferHtml, onPreferHtmlChanged = changeMode,
                                    onArticleBodyReady = { bodyReadyCount++ },
                                )
                            }
                        },
                    )
                } else Text("Loading")
            }
        }
        composeRule.waitUntil(5_000) { bodyReadyCount == 1 }
        val scroll = SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
        composeRule.onNode(scroll).performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 600f) }
        val offset = composeRule.onNode(scroll).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertTrue(offset > 0f)

        // Save the open reader, then separately release the restored cache and body.
        gate.pause()
        try {
            initialProcess = false
            tester.emulateSavedInstanceStateRestore()
            composeRule.onNode(scroll).assertDoesNotExist()
            composeRule.runOnIdle { cacheReady = true }
            composeRule.onNode(scroll).assertExists()
            composeRule.waitUntil(5_000) { gate.pendingCount > 0 }
            assertEquals("The restored shell is not a prepared body", 1, bodyReadyCount)
            gate.release()
            composeRule.waitUntil(5_000) { composeRule.runOnIdle { bodyReadyCount == 2 } }
            val restoredOffset = composeRule.onNode(scroll).fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
            assertEquals(offset, restoredOffset, 1f)
        } finally { gate.release() }
    }
    @Test
    fun `a drag during delayed preparation cancels pending scroll restoration`() {
        val tester = StateRestorationTester(composeRule)
        val gate = ReaderPreparationGate()
        val preparer = ReaderContentPreparer(gate)
        var readyCount = 0
        val article = ArticleDetail(
            id = "user-scroll", feedId = "feed", guid = "user-scroll", title = "Reader position",
            contentHtml = (1..100).joinToString("") {
                "<p>Paragraph $it. A long body that lets the reader choose a scroll position.</p>"
            },
            hash = "body", feedTitle = "Feed", isRead = true,
        )
        tester.setContent {
            CompositionLocalProvider(LocalReaderContentPreparer provides preparer) {
                SelfFeedTheme {
                    ArticleReaderPane(
                        articles = emptyList(), selectedArticle = article,
                        preferHtml = false,
                        onOpenOriginal = {}, onBackToList = {}, onArticleSelected = {},
                        onArticleBodyReady = { readyCount++ },
                    )
                }
            }
        }
        val scroll = SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
        composeRule.waitUntil(5_000) { composeRule.runOnIdle { readyCount == 1 } }
        composeRule.onNode(scroll).performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 600f) }
        gate.pause()
        try {
            tester.emulateSavedInstanceStateRestore()
            composeRule.waitUntil(5_000) { gate.pendingCount > 0 }
            composeRule.onNode(scroll).performTouchInput { swipeUp() }
            gate.release()
            composeRule.waitUntil(5_000) { composeRule.runOnIdle { readyCount == 2 } }
            val offset = composeRule.onNode(scroll)
                .fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
            assertEquals("A completed drag takes precedence over the saved offset", 0f, offset, 1f)
        } finally {
            gate.release()
        }
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
    fun `renderer recovery and its text fallback preserve the reading position`() {
        val gate = ReaderPreparationGate()
        val preparer = ReaderContentPreparer(gate)
        var readyCount = 0
        val article = ArticleDetail(
            id = "renderer-recovery", feedId = "feed", guid = "renderer", title = "Renderer recovery",
            contentHtml = (1..100).joinToString("") {
                "<p>Paragraph $it. Enough content to retain the reading position after a renderer failure.</p>"
            },
            hash = "body", feedTitle = "Feed", isRead = true,
        )
        composeRule.setContent {
            CompositionLocalProvider(LocalReaderContentPreparer provides preparer) {
                SelfFeedTheme {
                    ArticleReaderPane(
                        articles = emptyList(), selectedArticle = article, preferHtml = true,
                        onOpenOriginal = {}, onBackToList = {}, onArticleSelected = {},
                        onArticleBodyReady = { readyCount++ },
                    )
                }
            }
        }
        fun reader(): ReaderWebView? = composeRule.runOnIdle {
            fun find(view: View): ReaderWebView? {
                if (view is ReaderWebView) return view
                if (view is ViewGroup) {
                    for (index in 0 until view.childCount) find(view.getChildAt(index))?.let { return it }
                }
                return null
            }
            find(composeRule.activity.window.decorView)
        }
        composeRule.waitUntil(5_000) { reader() != null }
        val firstReader = checkNotNull(reader())
        composeRule.runOnIdle { firstReader.onHeight(5_000); firstReader.onReady() }
        composeRule.waitUntil(5_000) { composeRule.runOnIdle { readyCount == 1 } }
        val scroll = SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
        composeRule.onNode(scroll).performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 1_500f) }
        composeRule.runOnIdle { firstReader.onRendererGone() }
        composeRule.waitUntil(5_000) { reader()?.let { it !== firstReader } == true }
        val replacement = checkNotNull(reader())
        composeRule.runOnIdle { replacement.onHeight(5_000); replacement.onReady() }
        composeRule.waitUntil(5_000) { composeRule.runOnIdle { readyCount == 2 } }

        gate.pause()
        try {
            composeRule.runOnIdle { replacement.onRendererGone() }
            composeRule.waitUntil(5_000) { gate.pendingCount > 0 }
            gate.release()
            composeRule.waitUntil(5_000) { composeRule.runOnIdle { readyCount == 3 } }
            val restoredOffset = composeRule.onNode(scroll)
                .fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
            assertEquals(1_500f, restoredOffset, 1f)
        } finally {
            gate.release()
        }
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
