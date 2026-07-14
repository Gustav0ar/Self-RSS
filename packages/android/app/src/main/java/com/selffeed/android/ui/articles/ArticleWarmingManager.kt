package com.selffeed.android.ui.articles

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.network.ArticleListItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages adjacent article prefetching for instant navigation.
 * Warms up article details and hero images for nearby articles
 * to provide instant navigation experience.
 */
@Singleton
class ArticleWarmingManager @Inject constructor(
    private val repository: ArticleRepository,
) {
    private var scope: CoroutineScope? = null
    private var warmNextArticlesJob: Job? = null
    private var warmVisibleArticlesJob: Job? = null
    private var lastVisibleArticleIds: List<String> = emptyList()

    fun setScope(scope: CoroutineScope) {
        this.scope = scope
    }

    /**
     * Warms up adjacent articles around the given article ID.
     * Prefetches article details and hero images for nearby articles.
     */
    fun warmAdjacentArticles(articleId: String, items: List<ArticleListItem>) {
        val currentIndex = items.indexOfFirst { it.id == articleId }
        if (currentIndex == -1) return

        val previous = (currentIndex - 1 downTo 0)
            .take(PREVIOUS_ARTICLE_WARM_LIMIT)
            .map(items::get)
        val next = items
            .drop(currentIndex + 1)
            .take(NEXT_ARTICLE_WARM_LIMIT)
        // Forward navigation is the common path, so next articles get cache
        // priority. The current article is deliberately excluded.
        val articlesToWarm = (next + previous).distinctBy { it.id }
        if (articlesToWarm.isEmpty()) return

        // Prefetch hero images for all articles to warm
        repository.prefetchHeroImages(articlesToWarm.map { it.heroImageUrl })

        warmNextArticlesJob?.cancel()
        warmNextArticlesJob = scope?.launch {
            // Detail fetches run concurrently and are intentionally decoupled
            // from canonical enrichment. A slow publisher must never block the
            // next swipe target from entering memory/disk cache.
            val details = articlesToWarm.map { article ->
                async {
                    repository.cachedArticleDetail(article.id)
                        ?: when (val prefetched = repository.prefetchArticle(article.id)) {
                            is AppResult.Success -> prefetched.data
                            is AppResult.Error -> null
                        }
                }
            }.awaitAll()
            repository.prefetchHeroImages(details.map { it?.heroImageUrl })
        }
    }

    /**
     * Warms the first articles the user can act on before the first tap.
     * Canonical enrichment is merely prioritized; detail and image caching
     * remain useful immediately with feed-provided content.
     */
    fun warmVisibleArticles(items: List<ArticleListItem>) {
        val candidates = items.take(VISIBLE_ARTICLE_WARM_LIMIT).distinctBy { it.id }
        val candidateIds = candidates.map { it.id }
        if (candidateIds.isEmpty() || candidateIds == lastVisibleArticleIds) return
        lastVisibleArticleIds = candidateIds

        repository.prefetchHeroImages(candidates.map { it.heroImageUrl })
        warmVisibleArticlesJob?.cancel()
        warmVisibleArticlesJob = scope?.launch {
            val details = candidates.map { article ->
                async {
                    repository.cachedArticleDetail(article.id)
                        ?: when (val prefetched = repository.prefetchArticle(article.id)) {
                            is AppResult.Success -> prefetched.data
                            is AppResult.Error -> null
                        }
                }
            }.awaitAll()
            repository.prefetchHeroImages(details.map { it?.heroImageUrl })
            details
                .filter { it?.contentStatus == "enrichment_pending" }
                .forEach { detail -> repository.enrichArticle(detail!!.id, invalidateCaches = false) }
        }
    }

    /**
     * Cancels any pending warming job.
     */
    fun cancelWarming() {
        warmNextArticlesJob?.cancel()
        warmNextArticlesJob = null
        warmVisibleArticlesJob?.cancel()
        warmVisibleArticlesJob = null
        lastVisibleArticleIds = emptyList()
    }

    private companion object {
        const val NEXT_ARTICLE_WARM_LIMIT = 2
        const val PREVIOUS_ARTICLE_WARM_LIMIT = 1
        const val VISIBLE_ARTICLE_WARM_LIMIT = 4
    }
}
