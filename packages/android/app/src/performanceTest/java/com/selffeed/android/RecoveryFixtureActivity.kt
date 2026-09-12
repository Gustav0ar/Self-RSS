package com.selffeed.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
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
            if (savedInstanceState == null) {
                // Any background revalidation can only reach a closed loopback
                // port. No real server, publisher, account or credential is used.
                sessionStore.setApiBaseUrl("http://127.0.0.1:1")
                sessionStore.setAccessToken("isolated-review-fixture")
                localStore.writeArticleDetail(
                    ArticleDetail(
                        id = articleId, feedId = "fixture-feed", guid = nonce,
                        canonicalUrl = null, title = nonce, excerpt = "Cached recovery fixture",
                        contentHtml = "<p>Cached recovery fixture</p>", contentText = "Cached recovery fixture",
                        heroImageUrl = null, publishedAt = null, fetchedAt = "2026-01-01T00:00:00Z",
                        hash = nonce, feedTitle = "Local fixture", isRead = false,
                    ),
                )
            }
            val result = repository.article(articleId)
            check(result is AppResult.Success) { "Production repository could not recover the cached body" }
            setContent {
                SelfFeedTheme {
                    var confirmed by rememberSaveable { mutableStateOf(false) }
                    Column(Modifier.safeDrawingPadding()) {
                        Text(result.data.title)
                        Text(if (savedInstanceState != null) "Restored process" else "Initial process")
                        Text(if (confirmed) "Fixture confirmed" else "Fixture not confirmed")
                        Button(onClick = { confirmed = true }) { Text("Confirm fixture") }
                    }
                }
            }
        }
    }
}
