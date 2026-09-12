package com.selffeed.android.ui.components

import android.content.ComponentCallbacks2
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class ReaderModeScrollRestorationTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val gate = ReaderPreparationGate()
    private val preparer = ReaderContentPreparer(gate)
    private val articles = (1..2).map {
        ArticleListItem(
            id = "article-$it", feedId = "feed", title = "Article $it",
            feedTitle = "Feed", isRead = true,
        )
    }
    private val details = articles.associate { article ->
        article.id to ArticleDetail(
            id = article.id, feedId = "feed", guid = article.id, title = article.title,
            contentHtml = (1..100).joinToString("") {
                "<p>Paragraph $it. This article has enough readable content to preserve a scroll position.</p>"
            },
            hash = article.id, feedTitle = "Feed", isRead = true,
        )
    }
    private var selected by mutableStateOf(details.getValue("article-1"))
    private var preferHtml by mutableStateOf(true)
    private val readyCounts = mutableMapOf<String, Int>()
    private val completedArticles = mutableListOf<String>()

    @Test
    fun retainedPageKeepsItsPositionWhenModeChangesOnAnotherPage() {
        showReader()
        scrollFirstArticle()
        composeRule.onRoot().performTouchInput { swipeLeft() }
        composeRule.waitUntil(5_000) { selected.id == "article-2" }

        gate.pause()
        try {
            composeRule.onNode(hasText("Text") and hasAnyAncestor(articleScroll("Article 2"))).performClick()
            composeRule.waitUntil(5_000) { gate.pendingCount > 0 }
            gate.release()
            waitForBothBodies(2)
            composeRule.onRoot().performTouchInput { swipeRight() }
            composeRule.waitUntil(5_000) { selected.id == "article-1" }
            assertEquals(1_500f, firstArticleOffset(), 1f)
        } finally {
            gate.release()
        }
    }

    @Test
    fun pendingModeChangeKeepsItsPositionThroughRecreation() {
        val tester = showReader()
        scrollFirstArticle()
        gate.pause()
        try {
            composeRule.runOnIdle { preferHtml = false }
            composeRule.waitUntil(5_000) { gate.pendingCount > 0 }
            tester.emulateSavedInstanceStateRestore()
            composeRule.waitUntil(5_000) { gate.pendingCount >= 2 }
            gate.release()
            waitForBothBodies(2)
            assertEquals(1_500f, firstArticleOffset(), 1f)
        } finally {
            gate.release()
        }
    }

    @Test
    fun repeatedModeChangesKeepTheOffsetFromTheLastPreparedBody() {
        showReader()
        scrollFirstArticle()
        gate.pause()
        try {
            composeRule.runOnIdle { preferHtml = false }
            composeRule.waitUntil(5_000) { gate.pendingCount > 0 }
            composeRule.runOnIdle { preferHtml = true }
            composeRule.waitUntil(5_000) { gate.pendingCount >= 2 }
            composeRule.runOnIdle { preferHtml = false }
            composeRule.waitUntil(5_000) { gate.pendingCount >= 3 }
            gate.release()
            waitForBothBodies(2)
            assertEquals(1_500f, firstArticleOffset(), 1f)
        } finally {
            gate.release()
        }
    }

    @Test
    fun memoryTrimKeepsRetainedTextReadyForReadingCompletion() {
        showReader(rich = false)
        composeRule.runOnIdle {
            composeRule.activity.application.onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)
        }
        composeRule.waitForIdle()
        composeRule.onRoot().performTouchInput { swipeLeft() }
        composeRule.waitUntil(5_000) { selected.id == "article-2" }
        composeRule.onNode(articleScroll("Article 2"))
            .performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, Float.MAX_VALUE) }
        composeRule.mainClock.advanceTimeBy(6_000)
        composeRule.runOnIdle {
            assertEquals(listOf("article-2"), completedArticles)
        }
    }

    private fun showReader(rich: Boolean = true): StateRestorationTester {
        preferHtml = rich
        val tester = StateRestorationTester(composeRule)
        val content: @Composable () -> Unit = {
            CompositionLocalProvider(LocalReaderContentPreparer provides preparer) {
                SelfFeedTheme {
                    ArticleReaderPane(
                        articles = articles,
                        selectedArticle = selected,
                        prefetchedArticles = details,
                        onOpenOriginal = {},
                        onBackToList = {},
                        onArticleSelected = { selected = details.getValue(it) },
                        preferHtml = preferHtml,
                        onPreferHtmlChanged = { preferHtml = it },
                        onArticleBodyReady = { readyCounts[it] = readyCounts.getOrDefault(it, 0) + 1 },
                        onArticleCompleted = { completedArticles += it },
                    )
                }
            }
        }
        tester.setContent(content)
        if (rich) {
            composeRule.waitUntil(5_000) { readers().size == 2 }
            val initialReaders = readers()
            composeRule.runOnIdle {
                initialReaders.forEach { it.onHeight(5_000); it.onReady() }
            }
        }
        waitForBothBodies(1)
        return tester
    }

    private fun scrollFirstArticle() {
        composeRule.onNode(articleScroll("Article 1"))
            .performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 1_500f) }
        assertEquals(1_500f, firstArticleOffset(), 1f)
    }

    private fun firstArticleOffset(): Float = composeRule.onNode(articleScroll("Article 1"))
        .fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()

    private fun waitForBothBodies(count: Int) = composeRule.waitUntil(5_000) {
        composeRule.runOnIdle { articles.all { readyCounts.getOrDefault(it.id, 0) >= count } }
    }

    private fun articleScroll(title: String): SemanticsMatcher =
        SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange) and
            hasAnyDescendant(hasText(title))

    private fun readers(): List<ReaderWebView> = composeRule.runOnIdle {
        fun find(view: View): List<ReaderWebView> = buildList {
            if (view is ReaderWebView) add(view)
            if (view is ViewGroup) {
                for (index in 0 until view.childCount) addAll(find(view.getChildAt(index)))
            }
        }
        find(composeRule.activity.window.decorView)
    }
}
