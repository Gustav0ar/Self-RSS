package com.selffeed.android.ui.components

import androidx.activity.ComponentActivity
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
import java.util.concurrent.ConcurrentHashMap

class ReaderModeScrollRestorationDeviceTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun retainedPageKeepsItsPositionWhenModeChangesOnAnotherPage() {
        val readyCounts = ConcurrentHashMap<String, Int>()
        val gate = ReaderPreparationGate()
        val preparer = ReaderContentPreparer(gate)
        val articles = (1..2).map {
            ArticleListItem(
                id = "article-$it", feedId = "feed", title = "Article $it",
                feedTitle = "Feed", isRead = true,
            )
        }
        val details = articles.associate { article ->
            article.id to ArticleDetail(
                id = article.id, feedId = "feed", guid = article.id, title = article.title,
                contentHtml = (1..100).joinToString("") {
                    "<p>Paragraph $it. This article has enough readable content to preserve a scroll position.</p>"
                },
                hash = article.id, feedTitle = "Feed", isRead = true,
            )
        }
        var selected by mutableStateOf(details.getValue("article-1"))
        var preferHtml by mutableStateOf(true)
        composeRule.setContent {
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
                        onArticleBodyReady = { readyCounts.merge(it, 1, Int::plus) },
                    )
                }
            }
        }
        composeRule.waitUntil(10_000) { readyCounts.getOrDefault("article-1", 0) >= 1 }
        val firstScroll = articleScroll("Article 1")
        composeRule.onNode(firstScroll).performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 1_500f) }
        val initial = composeRule.onNode(firstScroll)
            .fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        assertEquals(1_500f, initial, 1f)
        composeRule.onRoot().performTouchInput { swipeLeft() }
        composeRule.waitUntil(5_000) { selected.id == "article-2" }
        composeRule.waitUntil(10_000) { readyCounts.getOrDefault("article-2", 0) >= 1 }

        gate.pause()
        try {
            composeRule.onNode(hasText("Text") and hasAnyAncestor(articleScroll("Article 2"))).performClick()
            composeRule.waitUntil(5_000) { gate.pendingCount > 0 }
            gate.release()
            composeRule.waitUntil(5_000) {
                articles.all { readyCounts.getOrDefault(it.id, 0) >= 2 }
            }
            composeRule.onRoot().performTouchInput { swipeRight() }
            composeRule.waitUntil(5_000) { selected.id == "article-1" }
            val restored = composeRule.onNode(firstScroll)
                .fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
            assertEquals(initial, restored, 1f)
        } finally {
            gate.release()
        }
    }

    private fun articleScroll(title: String): SemanticsMatcher =
        SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange) and
            hasAnyDescendant(hasText(title))
}
