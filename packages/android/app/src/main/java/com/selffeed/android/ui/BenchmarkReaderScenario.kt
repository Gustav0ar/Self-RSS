package com.selffeed.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.paging.PagingData
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf

/** Intent extra understood only by baseline-profile target variants. */
internal const val BenchmarkScenarioExtra = "com.selffeed.android.extra.BENCHMARK_SCENARIO"
internal const val BenchmarkReaderScenarioName = "reader"
internal const val BenchmarkArticleCardDescription = "Unread article: Reader navigation performance, from Self Feed"
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
 * A local, deterministic authenticated article-list → reader journey for
 * Baseline Profile generation. It renders the production app shell,
 * Navigation 3 list/detail transition, card, and HTML reader pane, but never
 * creates a network session or exposes this content in a shipped release.
 */
@Composable
internal fun BenchmarkReaderScenario() {
    var selectedArticle by remember { mutableStateOf<ArticleDetail?>(null) }
    val pagingData = remember { flowOf(PagingData.from(listOf(benchmarkArticle))) }
    val readStateOverrides = remember { MutableStateFlow<Map<String, Boolean>>(emptyMap()) }
    val state = SelfFeedAppState(
        auth = AuthUiState(loading = false, isAuthenticated = true),
        chrome = AppChromeState(activeTab = HomeTab.ARTICLES),
        feeds = FeedsUiState(),
        articles = ArticlesUiState(
            items = listOf(benchmarkArticle),
            readerQueue = listOf(benchmarkArticle),
            selectedArticle = selectedArticle,
        ),
        search = SearchUiState(),
        settings = SettingsUiState(),
        isOnline = true,
    )

    Box(modifier = Modifier.fillMaxSize()) {
        SelfFeedApp(
            state = state,
            readStateOverrides = readStateOverrides,
            articlePagingData = pagingData,
            actions = SelfFeedAppActions(
                onAuthModeChange = {},
                onLogin = { _, _, _ -> },
                onRegister = { _, _, _ -> },
                onLogout = {},
                onTabSelected = {},
                onRefreshVisibleData = {},
                onHideReadChanged = {},
                onCategorySelected = {},
                onFeedSelected = {},
                onRefreshArticles = {},
                onOpenArticle = { articleId ->
                    selectedArticle = benchmarkArticleDetail.takeIf { it.id == articleId }
                },
                onArticleDisplayed = {},
                onCloseArticle = { selectedArticle = null },
                onToggleRead = { _, _ -> },
                onMarkAllRead = {},
                onArticleSnapshot = {},
                onSearchQueryChanged = {},
                onSearchRequested = {},
                onLoadMoreSearch = {},
                onSearchCurrentCategoryOnlyChanged = {},
                onThemeChanged = {},
                onSortChanged = {},
                onDensityChanged = {},
                onTextSizeChanged = {},
                onRevokeAuthSession = {},
                onClearMessages = {},
            ),
        )

        if (selectedArticle != null) {
            Text(
                text = "Reader ready",
                modifier = Modifier
                    .semantics { contentDescription = BenchmarkReaderReadyDescription }
                    .padding(16.dp),
            )
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
