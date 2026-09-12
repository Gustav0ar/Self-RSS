package com.selffeed.android.ui

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.os.StrictMode
import androidx.room.Room
import androidx.compose.runtime.LaunchedEffect
import androidx.test.filters.SdkSuppress
import com.selffeed.android.data.local.LocalDatabase
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.network.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.util.UUID
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.selffeed.android.ui.components.LocalReaderContentPreparer
import com.selffeed.android.ui.components.ReaderContentPreparer
import com.selffeed.android.ui.components.ReaderHtmlContent
import com.selffeed.android.ui.components.ReaderPreparationGate
import com.selffeed.android.ui.components.ReaderTextContent
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.components.ReaderWebView
import com.selffeed.android.network.ArticleDetail
import androidx.lifecycle.Lifecycle
import com.selffeed.android.ui.theme.SelfFeedTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class AndroidMainThreadUiTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test @SdkSuppress(minSdkVersion = 28)
    fun cachedReaderNavigationAndClosingHaveNoMainDiskOrNetworkViolations() {
        val context = composeRule.activity.applicationContext
        val name = "reader-main-${UUID.randomUUID()}"
        val database = Room.databaseBuilder(context, LocalDatabase::class.java, name).build()
        val store = LocalStore(database, NetworkModule.provideMoshi())
        val gate = ReaderPreparationGate()
        val preparer = ReaderContentPreparer(gate)
        val ready = CopyOnWriteArrayList<String>()
        val violations = CopyOnWriteArrayList<android.os.strictmode.Violation>()
        var requested by mutableStateOf("first")
        var visible by mutableStateOf(true)
        var loaded by mutableStateOf<ArticleDetail?>(null)
        var previousPolicy: StrictMode.ThreadPolicy? = null
        try {
            runBlocking(Dispatchers.IO) {
                listOf("first", "second", "third", "closed").forEach { id ->
                    val html = "<p id='$id'>Cached $id article</p>" + (1..64).joinToString("") {
                        "<p>${"Readable cached paragraph $it. ".repeat(15)}</p>"
                    }
                    store.writeArticleDetail(ArticleDetail(
                        id = id, feedId = "feed", guid = id, hash = id,
                        title = "Cached $id article", feedTitle = "Fixture", isRead = false,
                        contentHtml = html, contentText = "Cached $id text",
                    ))
                }
            }
            composeRule.runOnUiThread {
                previousPolicy = StrictMode.getThreadPolicy()
                StrictMode.setThreadPolicy(
                    StrictMode.ThreadPolicy.Builder().detectDiskReads().detectDiskWrites().detectNetwork()
                        .penaltyListener({ command -> command.run() }) { violations.add(it) }.build(),
                )
            }
            composeRule.setContent {
                LaunchedEffect(requested, visible) {
                    if (visible) loaded = store.readArticleDetail(requested)
                }
                SelfFeedTheme(darkTheme = true) {
                    Column {
                        Button(onClick = { requested = "second" }) { Text("Second cached article") }
                        Button(onClick = { requested = "third" }) { Text("Third cached article") }
                        if (visible) loaded?.let { article ->
                            ReaderHtmlContent(
                                documentId = article.id, html = article.contentHtml!!,
                                backgroundColor = Color.Black, textColor = Color.White,
                                surfaceColor = Color.Black, mutedTextColor = Color.White, linkColor = Color.White,
                                documentBaseUrl = "https://example.invalid/${article.id}",
                                preparer = preparer, onReady = { ready += article.id },
                            )
                        }
                    }
                }
            }
            composeRule.waitUntil(15_000) { ready.contains("first") }
            val first = readers().single() as ReaderWebView
            gate.pause()
            composeRule.onNodeWithText("Second cached article").performClick()
            composeRule.waitUntil(5_000) { gate.pendingCount == 1 }
            composeRule.onNodeWithText("Third cached article").performClick()
            composeRule.waitUntil(5_000) { gate.pendingCount == 2 }
            gate.release()
            composeRule.waitUntil(15_000) { ready.contains("third") }
            assertEquals(listOf("first", "third"), ready.toList())
            assertTrue(first.released)
            val current = readers().single() as ReaderWebView
            assertEquals("true", javascript(current, "!!document.getElementById('third')"))

            gate.pause()
            composeRule.runOnIdle { requested = "closed" }
            composeRule.waitUntil(5_000) { gate.pendingCount == 1 }
            composeRule.runOnIdle { visible = false }
            gate.release()
            composeRule.waitUntil(5_000) { gate.isIdle }
            composeRule.waitForIdle()
            assertTrue(current.released)
            assertEquals(0, readers().size)
            assertEquals(listOf("first", "third"), ready.toList())
            assertEquals(emptyList<android.os.strictmode.Violation>(), violations.toList())
        } finally {
            gate.release()
            try {
                composeRule.runOnIdle { visible = false }
                composeRule.waitForIdle()
            } finally {
                try {
                    composeRule.runOnUiThread { previousPolicy?.let(StrictMode::setThreadPolicy) }
                } finally {
                    runBlocking { withContext(Dispatchers.IO) { database.close(); context.deleteDatabase(name) } }
                }
            }
        }
    }

    @Test fun inputRemainsUsableAndOnlyTheReplacementArticleIsRendered() {
        val gate = ReaderPreparationGate().apply { pause() }
        val fixture = HtmlFixture()
        showHtml(fixture, gate)
        try {
            composeRule.waitUntil(5_000) { gate.pendingCount == 1 }
            assertEquals(0, readers().size)
            composeRule.onNodeWithText("Respond").performClick()
            composeRule.onNodeWithText("Input: 1").assertIsDisplayed()
            composeRule.runOnIdle { fixture.id = "second"; fixture.textSize = 22 }
            composeRule.waitUntil(5_000) { gate.pendingCount == 2 }
            gate.release()
            composeRule.waitUntil(15_000) { fixture.ready.isNotEmpty() }
            assertEquals(listOf("second"), fixture.ready.toList())
            val reader = readers().single()
            assertEquals("true", javascript(reader, "!!document.getElementById('second')"))
            assertEquals("false", javascript(reader, "!!document.getElementById('first')"))
            assertEquals("\"https://example.invalid/second\"", javascript(reader, "document.baseURI"))
            assertEquals("\"22px\"", javascript(reader, "getComputedStyle(document.body).fontSize"))
        } finally { gate.release() }
    }

    @Test fun enrichmentKeepsThePreviousHtmlPairedWithItsBaseUrlUntilPreparationCompletes() {
        val gate = ReaderPreparationGate()
        val fixture = HtmlFixture(longBody = true)
        showHtml(fixture, gate)
        try {
            composeRule.waitUntil(15_000) { fixture.ready.isNotEmpty() }
            val reader = readers().single()
            composeRule.waitUntil(5_000) { composeRule.runOnIdle { reader.height > 2_000 && fixture.scroll.maxValue > 2_000 } }
            composeRule.runOnIdle { fixture.scroll.dispatchRawDelta(1_500f) }
            val height = composeRule.runOnIdle { reader.height }
            assertEquals(1_500, composeRule.runOnIdle { fixture.scroll.value })
            gate.pause()
            composeRule.runOnIdle { fixture.version = 2 }
            composeRule.waitUntil(5_000) { gate.pendingCount == 1 }
            assertEquals("Preparing enrichment must retain the displayed document height", height, composeRule.runOnIdle { reader.height })
            assertEquals("Preparing enrichment must preserve reading position", 1_500, composeRule.runOnIdle { fixture.scroll.value })
            assertEquals("\"https://example.invalid/first\"", javascript(reader, "document.baseURI"))
            assertEquals("false", javascript(reader, "!!document.getElementById('enriched')"))
            gate.release()
            composeRule.waitUntil(10_000) { javascript(reader, "!!document.getElementById('enriched')") == "true" }
            assertEquals("\"https://example.invalid/enriched\"", javascript(reader, "document.baseURI"))
            assertTrue(readers().single() === reader)
        } finally { gate.release() }
    }

    @Test fun closingDuringPreparationDoesNotCreateAHiddenRendererOrPublishReadiness() {
        val gate = ReaderPreparationGate().apply { pause() }
        val fixture = HtmlFixture()
        showHtml(fixture, gate)
        try {
            composeRule.waitUntil(5_000) { gate.pendingCount == 1 }
            composeRule.runOnIdle { fixture.visible = false }
            composeRule.onNodeWithText("Reader closed").assertIsDisplayed()
            gate.release()
            composeRule.waitUntil(5_000) { gate.isIdle }
            composeRule.waitForIdle()
            assertEquals(0, readers().size)
            assertTrue(fixture.ready.isEmpty())
        } finally { gate.release() }
    }

    @Test fun textPreparationRetainsInputResponsivenessAndDiscardsAnObsoleteArticle() {
        val gate = ReaderPreparationGate().apply { pause() }
        val preparer = ReaderContentPreparer(gate)
        var article by mutableStateOf("first")
        var clicks by mutableIntStateOf(0)
        val ready = CopyOnWriteArrayList<String>()
        composeRule.setContent {
            CompositionLocalProvider(LocalReaderContentPreparer provides preparer) {
                SelfFeedTheme {
                    Column {
                        Button(onClick = { clicks++ }) { Text("Respond") }
                        Text("Input: $clicks")
                        val current = article
                        ReaderTextContent(current, "<p>$current body</p>", null, null, onReady = { ready += current })
                    }
                }
            }
        }
        try {
            composeRule.waitUntil(5_000) { gate.pendingCount == 1 }
            composeRule.onNodeWithText("Respond").performClick()
            composeRule.onNodeWithText("Input: 1").assertIsDisplayed()
            composeRule.runOnIdle { article = "second" }
            composeRule.waitUntil(5_000) { gate.pendingCount == 2 }
            gate.release()
            composeRule.waitUntil(5_000) {
                composeRule.onAllNodesWithTag("reader-text-content").fetchSemanticsNodes().isNotEmpty()
            }
            composeRule.onNodeWithText("second body").assertIsDisplayed()
            composeRule.onNodeWithText("first body").assertDoesNotExist()
            assertEquals(listOf("second"), ready.toList())
        } finally { gate.release() }
    }

    @Test fun richToTextAfterBackgroundingSupportsDelayedPreparation() {
        val gate = ReaderPreparationGate()
        val preparer = ReaderContentPreparer(gate)
        var rich by mutableStateOf(true)
        var visible by mutableStateOf(true)
        val ready = CopyOnWriteArrayList<String>()
        val article = ArticleDetail(
            id = "mode-change", feedId = "feed", guid = "mode-change", title = "Mode change",
            contentHtml = "<p>Prepared text body after returning to the reader.</p>",
            hash = "body", feedTitle = "Feed", isRead = true,
        )
        composeRule.setContent {
            CompositionLocalProvider(LocalReaderContentPreparer provides preparer) {
                SelfFeedTheme {
                    ArticleReaderPane(
                        articles = emptyList(), selectedArticle = article, preferHtml = rich, isVisible = visible,
                        onOpenOriginal = {}, onBackToList = {}, onArticleSelected = {},
                        onArticleBodyReady = { ready += it },
                    )
                }
            }
        }
        try {
            composeRule.waitUntil(15_000) { ready.isNotEmpty() }
            val reader = readers().single() as ReaderWebView
            composeRule.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
            composeRule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
            composeRule.runOnIdle { visible = false }
            composeRule.runOnIdle { visible = true }
            gate.pause()
            composeRule.runOnIdle { rich = false }
            composeRule.waitUntil(5_000) { gate.pendingCount == 1 }
            composeRule.waitForIdle()
            assertTrue(reader.released)
            assertEquals(0, readers().size)
            gate.release()
            composeRule.waitUntil(5_000) {
                composeRule.onAllNodesWithTag("reader-text-content").fetchSemanticsNodes().isNotEmpty()
            }
            composeRule.onNodeWithText("Prepared text body after returning to the reader.").assertIsDisplayed()
        } finally { gate.release() }
    }

    private class HtmlFixture(val longBody: Boolean = false) {
        var id by mutableStateOf("first")
        var version by mutableIntStateOf(1)
        var textSize by mutableIntStateOf(16)
        var visible by mutableStateOf(true)
        val ready = CopyOnWriteArrayList<String>()
        val scroll = ScrollState(0)
    }

    private fun showHtml(fixture: HtmlFixture, gate: ReaderPreparationGate) {
        val preparer = ReaderContentPreparer(gate)
        var clicks by mutableIntStateOf(0)
        composeRule.setContent {
            CompositionLocalProvider(LocalReaderContentPreparer provides preparer) {
                SelfFeedTheme {
                    Column(Modifier.verticalScroll(fixture.scroll)) {
                        Button(onClick = { clicks++ }) { Text("Respond") }
                        Text("Input: $clicks")
                        if (fixture.visible) {
                            val id = fixture.id
                            val bodyId = if (fixture.version == 1) id else "enriched"
                            ReaderHtmlContent(
                                documentId = id, html = "<p id='$bodyId'>Prepared $bodyId body</p>" +
                                    if (fixture.longBody) (1..100).joinToString("") { "<p>Paragraph $it retains the reading position through enrichment.</p>" } else "",
                                backgroundColor = Color.Black, textColor = Color.White, surfaceColor = Color.Black,
                                mutedTextColor = Color.White, linkColor = Color.White,
                                appearance = ReaderAppearance(textSizeSp = fixture.textSize),
                                documentBaseUrl = "https://example.invalid/$bodyId",
                                onReady = { fixture.ready += id },
                            )
                        } else Text("Reader closed")
                    }
                }
            }
        }
    }

    private fun readers(): List<WebView> = composeRule.runOnIdle {
        fun find(view: View): List<WebView> = buildList {
            if (view is WebView) add(view)
            if (view is ViewGroup) for (index in 0 until view.childCount) addAll(find(view.getChildAt(index)))
        }
        find(composeRule.activity.window.decorView)
    }

    private fun javascript(view: WebView, script: String): String {
        val completed = CountDownLatch(1)
        var result = ""
        composeRule.runOnUiThread { view.evaluateJavascript(script) { result = it; completed.countDown() } }
        check(completed.await(3, TimeUnit.SECONDS)) { "Chromium callback timed out" }
        return result
    }
}
