package com.selffeed.android.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import com.selffeed.android.MainActivity
import com.selffeed.android.data.FakeSelfFeedRepository
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.After
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
    fun loginFlow_acceptsHostOnlyServerAndOpensWorkspace() {
        repository.reset(authenticated = false)
        launchActivity()

        composeRule.onNodeWithText("Server").performTextClearance()
        composeRule.onNodeWithText("Server").performTextInput("10.0.22.22:3000")
        composeRule.onNodeWithText("Email").performTextInput("reader@example.com")
        composeRule.onNodeWithText("Password").performTextInput("password123")
        composeRule.onNodeWithText("Continue").performClick()

        composeRule.waitUntil(timeoutMillis = 5_000) {
            repository.getApiBaseUrl() == "10.0.22.22:3000"
        }
        composeRule.onNodeWithText("Injected Article").assertIsDisplayed()
    }

    private fun launchActivity() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }
}
