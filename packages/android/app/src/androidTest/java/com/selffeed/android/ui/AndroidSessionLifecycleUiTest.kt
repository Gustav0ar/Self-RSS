package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import com.selffeed.android.MainActivity
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.FakeSelfFeedRepository
import com.selffeed.android.data.ReviewRequestGate
import com.selffeed.android.network.ArticleDetail
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import javax.inject.Inject

@HiltAndroidTest
class AndroidSessionLifecycleUiTest {
    @get:Rule(order = 0) val hiltRule = HiltAndroidRule(this)
    @get:Rule(order = 1) val composeRule = createEmptyComposeRule()
    @Inject lateinit var repository: FakeSelfFeedRepository
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before fun setup() { hiltRule.inject() }
    @After fun close() { scenario?.close() }

    @Test
    fun backCancelsThePendingDetailAndTheNextArticleOpensNormally() {
        repository.reset(authenticated = true)
        val gate = ReviewRequestGate<String, AppResult<ArticleDetail>>()
        repository.detailGate = gate
        val reads = ReviewRequestGate<Pair<String, Boolean>, AppResult<Boolean>>()
        repository.readGate = reads
        scenario = ActivityScenario.launch(MainActivity::class.java)
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithText("Injected Article").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("Injected Article").performClick()
        val request = runBlocking { withTimeout(5_000) { gate.next() } }
        assertEquals("article-1", request.input)
        val read = runBlocking { withTimeout(5_000) { reads.next() } }
        composeRule.onNodeWithContentDescription("Back to list").performClick()
        composeRule.waitUntil(5_000) { request.response.isCancelled }
        assertFalse(request.response.complete(AppResult.Error("Old detail failed")))
        assertFalse(read.response.isCancelled)
        read.response.complete(AppResult.Error("Old read update failed"))
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithContentDescription("Back to list").fetchSemanticsNodes().isEmpty()
        }
        composeRule.onNodeWithContentDescription("Open feeds").assertIsDisplayed()

        repository.detailGate = null
        repository.readGate = null
        composeRule.onNodeWithText("Injected Article 2").performClick()
        composeRule.onNodeWithContentDescription("Back to list").assertIsDisplayed()
        composeRule.onNodeWithText("Injected Article 2").assertIsDisplayed()
    }
}

class ResumeRefreshObserverUiTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun resumeUsesTheLatestCallbackAndDisposalRemovesTheObserver() {
        var oldCalls = 0
        var currentCalls = 0
        val callback = mutableStateOf<() -> Unit>({ oldCalls++ })
        val visible = mutableStateOf(true)
        composeRule.setContent {
            if (visible.value) ResumeRefreshObserver(callback.value)
        }
        composeRule.runOnIdle {
            assertEquals(1, oldCalls)
            callback.value = { currentCalls++ }
        }
        composeRule.waitForIdle()
        composeRule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        composeRule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        composeRule.runOnIdle {
            assertEquals(1, oldCalls)
            assertEquals(1, currentCalls)
            visible.value = false
        }
        composeRule.waitForIdle()
        composeRule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        composeRule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        composeRule.runOnIdle { assertEquals(1, currentCalls) }
    }
}
