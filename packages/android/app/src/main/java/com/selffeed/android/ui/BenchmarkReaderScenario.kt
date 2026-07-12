package com.selffeed.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.ui.components.ArticleReaderPane
import com.selffeed.android.ui.screens.ArticleCard

/** Intent extra understood only by baseline-profile target variants. */
internal const val BenchmarkScenarioExtra = "com.selffeed.android.extra.BENCHMARK_SCENARIO"
internal const val BenchmarkReaderScenarioName = "reader"
internal const val BenchmarkArticleCardDescription = "Open benchmark article"
internal const val BenchmarkReaderReadyDescription = "Benchmark reader ready"

enum class BenchmarkScenario {
    READER,
}

/**
 * Keeps synthetic benchmark content out of debug and production releases.
 * The Baseline Profile plugin uses one of these generated target variants.
 */
internal fun benchmarkScenarioFor(
    buildType: String,
    requestedScenario: String?,
): BenchmarkScenario? {
    if (buildType !in benchmarkBuildTypes) return null
    return when (requestedScenario) {
        BenchmarkReaderScenarioName -> BenchmarkScenario.READER
        else -> null
    }
}

private val benchmarkBuildTypes = setOf("benchmarkRelease", "nonMinifiedRelease")

/**
 * A local, deterministic article-list → reader journey for Baseline Profile
 * generation. It deliberately renders the production card and reader pane,
 * but never creates a network session or exposes this content in a shipped
 * release build.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun BenchmarkReaderScenario() {
    var isReaderOpen by rememberSaveable { mutableStateOf(false) }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(if (isReaderOpen) "Article" else "Articles") },
            )
        },
    ) { contentPadding ->
        AnimatedContent(
            targetState = isReaderOpen,
            label = "benchmark-reader-navigation",
        ) { readerOpen ->
            if (readerOpen) {
                Box(modifier = Modifier.fillMaxSize().padding(contentPadding)) {
                    ArticleReaderPane(
                        articles = listOf(benchmarkArticle),
                        selectedArticle = benchmarkArticleDetail,
                        onOpenOriginal = {},
                        onBackToList = { isReaderOpen = false },
                        onArticleSelected = {},
                    )
                    Text(
                        text = "Reader ready",
                        modifier = Modifier
                            .semantics { contentDescription = BenchmarkReaderReadyDescription }
                            .padding(16.dp),
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(contentPadding),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    item(key = benchmarkArticle.id) {
                        Box(
                            modifier = Modifier
                                .semantics { contentDescription = BenchmarkArticleCardDescription }
                                .clickable { isReaderOpen = true },
                        ) {
                            ArticleCard(
                                article = benchmarkArticle,
                                selected = false,
                                onClick = {},
                            )
                        }
                    }
                }
            }
        }
    }
}

private val benchmarkArticle = ArticleListItem(
    id = "benchmark-article",
    feedId = "benchmark-feed",
    feedTitle = "Self Feed",
    title = "Reader navigation performance",
    excerpt = "A stable local article used only while generating the Baseline Profile.",
    publishedAt = "2026-01-01T00:00:00.000Z",
    isRead = false,
)

private val benchmarkArticleDetail = ArticleDetail(
    id = benchmarkArticle.id,
    feedId = benchmarkArticle.feedId,
    guid = benchmarkArticle.id,
    canonicalUrl = null,
    title = benchmarkArticle.title,
    excerpt = benchmarkArticle.excerpt,
    // Keep this entirely local while taking the same HTML/WebView reader
    // branch used by enriched production articles.
    contentHtml = "<p>The reader screen is fully ready without waiting for a network response.</p>",
    contentText = "The reader screen is fully ready without waiting for a network response.",
    heroImageUrl = null,
    publishedAt = benchmarkArticle.publishedAt,
    fetchedAt = benchmarkArticle.publishedAt,
    hash = "benchmark-article-hash",
    feedTitle = benchmarkArticle.feedTitle,
    isRead = false,
)
