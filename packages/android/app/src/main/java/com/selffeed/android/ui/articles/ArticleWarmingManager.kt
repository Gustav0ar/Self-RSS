package com.selffeed.android.ui.articles

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.job
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
    private val warmingJobs = mutableMapOf<String, Job>()
    private var lastVisibleArticleIds: List<String> = emptyList()
    private var onArticlesWarmed: (List<ArticleDetail>) -> Unit = {}

    fun setScope(scope: CoroutineScope) {
        this.scope = scope
    }

    fun setOnArticlesWarmed(callback: (List<ArticleDetail>) -> Unit) {
        onArticlesWarmed = callback
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

        warmArticles(articlesToWarm, enrichPending = true)
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

        warmArticles(candidates, enrichPending = true)
    }

    /**
     * Cancels any pending warming job.
     */
    fun cancelWarming() {
        warmingJobs.values.forEach(Job::cancel)
        warmingJobs.clear()
        lastVisibleArticleIds = emptyList()
    }

    private fun warmArticles(candidates: List<ArticleListItem>, enrichPending: Boolean) {
        repository.prefetchHeroImages(candidates.map { it.heroImageUrl })

        val cached = candidates.mapNotNull { repository.cachedArticleDetail(it.id) }
        publishWarmed(cached)

        val activeScope = scope ?: return
        candidates.forEach { article ->
            if (cached.any { it.id == article.id } || warmingJobs[article.id]?.isActive == true) return@forEach

            val job = activeScope.launch(start = CoroutineStart.LAZY) {
                try {
                    val detail = when (val prefetched = repository.prefetchArticle(article.id)) {
                        is AppResult.Success -> prefetched.data
                        is AppResult.Error -> null
                    }
                    if (detail != null) {
                        publishWarmed(listOf(detail))
                        if (enrichPending && detail.contentStatus == "enrichment_pending") {
                            repository.enrichArticle(detail.id, invalidateCaches = false)
                        }
                    }
                } finally {
                    warmingJobs.remove(article.id, coroutineContext.job)
                }
            }
            warmingJobs[article.id] = job
            job.start()
        }
    }

    private fun publishWarmed(details: List<ArticleDetail>) {
        if (details.isEmpty()) return
        onArticlesWarmed(details)
        repository.prefetchHeroImages(
            details.flatMap { detail ->
                buildList {
                    add(detail.heroImageUrl)
                    detail.media
                        .asSequence()
                        .filter { it.type == "image" }
                        .mapTo(this) { it.url }
                }
            },
        )
    }

    private companion object {
        const val NEXT_ARTICLE_WARM_LIMIT = 6
        const val PREVIOUS_ARTICLE_WARM_LIMIT = 4
        const val VISIBLE_ARTICLE_WARM_LIMIT = 8
    }
}
