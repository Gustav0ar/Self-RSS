package com.selffeed.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.data.SessionStore
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.repository.LocalArticleState
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.ui.theme.SelfFeedTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Test-build-only entry point for verifying the external process harness and real Room recovery. */
@AndroidEntryPoint
class RecoveryFixtureActivity : ComponentActivity() {
    @Inject lateinit var repository: RssRepository
    @Inject lateinit var localStore: LocalStore
    @Inject lateinit var sessionStore: SessionStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            sessionStore.preload()
            val nonce = requireNotNull(intent.getStringExtra("fixtureNonce"))
            val articleId = "recovery-$nonce"
            val outboxPort = intent.getIntExtra("outboxPort", 0)
            check(outboxPort in 0..65535)
            if (savedInstanceState == null) {
                // The external runner owns the loopback fixture server. Ordinary
                // recovery uses a closed port; neither mode reaches a real service.
                check(repository.setApiBaseUrl("http://127.0.0.1:${outboxPort.takeIf { it > 0 } ?: 1}") is AppResult.Success)
                check(localStore.readOwner()?.ownerId == sessionStore.currentSession().ownerId)
                sessionStore.setAccessToken("isolated-review-fixture")
                localStore.writeArticleDetail(
                    ArticleDetail(
                        id = articleId, feedId = "fixture-feed", guid = nonce,
                        canonicalUrl = null, title = nonce, excerpt = "Cached recovery fixture",
                        contentHtml = "<p>Cached recovery fixture</p>", contentText = "Cached recovery fixture",
                        heroImageUrl = null, publishedAt = null, fetchedAt = "2026-01-01T00:00:00Z",
                        hash = nonce, feedTitle = "Local fixture", isRead = false,
                        readRevision = 0, savedRevision = 0,
                    ),
                )
            }
            if (savedInstanceState == null && outboxPort > 0) {
                check(repository.markRead(articleId, true) is AppResult.Success)
                check(repository.setSaved(articleId, true) is AppResult.Success)
            }
            check(sessionStore.getAccessToken() == "isolated-review-fixture") { "Fixture credential was not restored" }
            val sessionOwner = sessionStore.currentSession().ownerId
            val result = repository.article(articleId)
            check(result is AppResult.Success) {
                "Production repository could not recover the cached body: ${(result as? AppResult.Error)?.message}"
            }
            check(result.data.id == articleId)
            check(result.data.contentHtml == "<p>Cached recovery fixture</p>") { "Cached HTML was not restored" }
            check(result.data.contentText == "Cached recovery fixture") { "Cached text was not restored" }
            val states = localStore.observeArticleStates(setOf(articleId), sessionOwner)
            setContent {
                SelfFeedTheme {
                    val observed by states.collectAsStateWithLifecycle(emptyMap())
                    val state = observed[articleId] ?: LocalArticleState(null, null)
                    var confirmed by rememberSaveable { mutableStateOf(false) }
                    Column(Modifier.safeDrawingPadding()) {
                        Text(result.data.title)
                        Text("Owner: $sessionOwner")
                        Text(if (savedInstanceState != null) "Restored process" else "Initial process")
                        if (outboxPort > 0) {
                            Text("Read: ${state.lastReadMutationId}")
                            Text("Saved: ${state.lastSavedMutationId}")
                            Text("Pending: ${listOfNotNull(state.pendingReadMutationId, state.pendingSavedMutationId).size}")
                            Text("Flags: ${state.isRead}/${state.isSaved}")
                            Text("Revisions: ${state.readRevision}/${state.savedRevision}")
                        }
                        Text(if (confirmed) "Fixture confirmed" else "Fixture not confirmed")
                        Button(onClick = { confirmed = true }) { Text("Confirm fixture") }
                    }
                }
            }
        }
    }
}
