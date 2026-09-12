package com.selffeed.android.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Looper
import android.os.StrictMode
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.filters.SdkSuppress
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.FakeSelfFeedRepository
import com.selffeed.android.data.OpmlExportStore
import com.selffeed.android.data.repository.FeedRepository
import com.selffeed.android.ui.components.shareOpmlFile
import com.selffeed.android.ui.screens.OpmlDocumentReader
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class OpmlExportUiTest {
    @get:Rule val composeRule = createEmptyComposeRule()
    private val maintenance = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val response = CompletableDeferred<AppResult<String>>()
    private val handoffs = CopyOnWriteArrayList<Pair<Context, Uri>>()
    private var currentSession = true
    private var scenario: ActivityScenario<ComponentActivity>? = null
    private lateinit var model: FeedsViewModel

    @After fun close() {
        scenario?.close()
        runBlocking { maintenance.coroutineContext.job.children.toList().forEach { it.join() } }
        maintenance.cancel()
    }

    @Test fun exportCompletedWhileStoppedSurvivesRecreationAndSharesOnceOnResume() {
        launch()
        scenario!!.onActivity { model.exportOpml() }
        scenario!!.moveToState(Lifecycle.State.CREATED)
        response.complete(AppResult.Success("<opml>retained</opml>"))
        composeRule.waitUntil(5_000) { model.opmlExports.value != null }
        assertTrue(handoffs.isEmpty())
        val before = model

        scenario!!.recreate()
        attach()
        assertSame(before, model)
        assertTrue(handoffs.isEmpty())
        scenario!!.moveToState(Lifecycle.State.RESUMED)
        composeRule.waitUntil(5_000) { handoffs.size == 1 }
        scenario!!.onActivity { assertSame(it, handoffs.single().first) }
        assertNull(model.opmlExports.value)
        repeat(2) {
            scenario!!.moveToState(Lifecycle.State.CREATED)
            scenario!!.moveToState(Lifecycle.State.RESUMED)
        }
        composeRule.waitForIdle()
        assertEquals(1, handoffs.size)
    }

    @Test fun aRetiredAccountCannotShareItsPendingFile() {
        launch()
        scenario!!.onActivity { model.exportOpml() }
        scenario!!.moveToState(Lifecycle.State.CREATED)
        response.complete(AppResult.Success("<opml>old account</opml>"))
        composeRule.waitUntil(5_000) { model.opmlExports.value != null }
        currentSession = false
        scenario!!.moveToState(Lifecycle.State.RESUMED)
        composeRule.waitForIdle()
        assertTrue(handoffs.isEmpty())
        val pending = model.opmlExports.value!!
        scenario!!.close()
        scenario = null
        composeRule.waitUntil(5_000) { !pending.file.exists() }
        assertNull(model.opmlExports.value)
    }

    @Test @SdkSuppress(minSdkVersion = 33)
    fun preparationAndMaintenanceAreMainSafeAndTheChooserGrantsOnlyReadAccess() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val store = OpmlExportStore(app, maintenance)
        val violations = CopyOnWriteArrayList<android.os.strictmode.Violation>()
        val prepared = withContext(Dispatchers.Main) {
            val previous = StrictMode.getThreadPolicy()
            StrictMode.setThreadPolicy(
                StrictMode.ThreadPolicy.Builder().detectDiskReads().detectDiskWrites().detectNetwork()
                    .penaltyListener({ command -> command.run() }) { violations.add(it) }.build(),
            )
            try {
                assertSame(Looper.getMainLooper(), Looper.myLooper())
                store.reapStaleExports()
                store.prepare("<opml>actual FileProvider 日本語</opml>").also { store.renewRetention(it) }
            } finally { StrictMode.setThreadPolicy(previous) }
        }
        try {
            assertEquals(emptyList<android.os.strictmode.Violation>(), violations.toList())
            assertEquals("content", prepared.uri.scheme)
            assertEquals("<opml>actual FileProvider 日本語</opml>", withContext(Dispatchers.IO) {
                app.contentResolver.openInputStream(prepared.uri)!!.bufferedReader().use { it.readText() }
            })
            var chooser: Intent? = null
            val recipient = object : android.content.ContextWrapper(app) {
                override fun startActivity(intent: Intent) { chooser = intent }
            }
            withContext(Dispatchers.Main) { shareOpmlFile(recipient, prepared.uri) }
            assertEquals(Intent.ACTION_CHOOSER, chooser!!.action)
            val send = chooser!!.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)!!
            assertEquals(Intent.ACTION_SEND, send.action)
            assertEquals("application/xml", send.type)
            assertEquals(prepared.uri, send.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
            assertEquals(prepared.uri, send.clipData!!.getItemAt(0).uri)
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, send.flags)
        } finally { store.release(prepared, shared = false) }
    }

    private fun launch() {
        scenario = ActivityScenario.launch(ComponentActivity::class.java)
        attach()
        composeRule.waitForIdle()
    }

    private fun attach() {
        scenario!!.onActivity { activity ->
            val app = activity.applicationContext
            val repository = object : FeedRepository by FakeSelfFeedRepository() {
                override suspend fun exportOpml(): AppResult<String> = response.await()
            }
            val factory = object : ViewModelProvider.Factory {
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    @Suppress("UNCHECKED_CAST")
                    return FeedsViewModel(repository, OpmlDocumentReader(app), OpmlExportStore(app, maintenance)) as T
                }
            }
            model = ViewModelProvider(activity, factory)[FeedsViewModel::class.java]
            activity.setContent {
                OpmlExportEffect(model, isCurrentSession = { currentSession }) { context, uri ->
                    assertTrue(activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
                    handoffs.add(context to uri)
                }
            }
        }
    }
}
