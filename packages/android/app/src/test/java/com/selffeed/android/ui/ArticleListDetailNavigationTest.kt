package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertTrue
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
                    initialPreferHtml = false,
                    onCloseArticle = {
                        readerClosed = true
                        selectedArticleId = null
                    },
                    listContent = {
                        Button(onClick = { selectedArticleId = "article-1" }) { Text("Open article") }
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
    fun richModeSurvivesReplacingTheDetailDestination() {
        composeRule.setContent {
            var selectedArticleId by remember { mutableStateOf<String?>("article-1") }
            SelfFeedTheme {
                ArticleListDetailNavigation(
                    selectedArticleId = selectedArticleId,
                    initialPreferHtml = selectedArticleId == "article-1",
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
}
