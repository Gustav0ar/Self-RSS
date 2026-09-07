package com.selffeed.android.ui.components

import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performSemanticsAction
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
}
