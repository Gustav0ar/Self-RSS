package com.selffeed.android.ui.articles

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.SelfFeedRepository
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
    private val repository: SelfFeedRepository,
) {
    private var scope: CoroutineScope? = null
    private var warmNextArticlesJob: Job? = null

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
     * Cancels any pending warming job.
     */
    fun cancelWarming() {
        warmNextArticlesJob?.cancel()
        warmNextArticlesJob = null
    }

    private companion object {
        const val NEXT_ARTICLE_WARM_LIMIT = 2
        const val PREVIOUS_ARTICLE_WARM_LIMIT = 1
    }
}
