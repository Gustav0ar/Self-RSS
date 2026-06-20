package com.selffeed.android.ui.articles

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.SelfFeedRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.ArticleListItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Collections
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
    private val backgroundEnrichAttemptedAt = Collections.synchronizedMap(mutableMapOf<String, Long>())

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

        val previous = items
            .asReversed()
            .drop(items.size - 1 - currentIndex)
            .take(NEXT_ARTICLE_WARM_LIMIT)
        val next = items
            .drop(currentIndex + 1)
            .take(NEXT_ARTICLE_WARM_LIMIT)
        val articlesToWarm = (previous + next).distinct()
        if (articlesToWarm.isEmpty()) return

        // Prefetch hero images for all articles to warm
        repository.prefetchHeroImages(articlesToWarm.map { it.heroImageUrl })

        warmNextArticlesJob?.cancel()
        warmNextArticlesJob = scope?.launch {
            for (article in articlesToWarm) {
                val detail = repository.cachedArticleDetail(article.id)
                    ?: when (val prefetched = repository.prefetchArticle(article.id)) {
                        is AppResult.Success -> prefetched.data
                        is AppResult.Error -> continue
                    }

                repository.prefetchHeroImages(listOf(detail.heroImageUrl))

                if (!shouldAttemptBackgroundEnrichment(detail)) continue

                when (val enriched = repository.enrichArticle(article.id, invalidateCaches = false)) {
                    is AppResult.Success -> {
                        if (enriched.data.success || enriched.data.reason == "already_enriched") {
                            delay(ARTICLE_ENRICH_REFRESH_DELAY_MS)
                            repository.refreshArticleDetail(article.id)
                        }
                    }
                    is AppResult.Error -> Unit
                }
            }
        }
    }

    /**
     * Cancels any pending warming job.
     */
    fun cancelWarming() {
        warmNextArticlesJob?.cancel()
        warmNextArticlesJob = null
    }

    private fun shouldAttemptBackgroundEnrichment(article: ArticleDetail): Boolean {
        if (article.isEnriched || article.canonicalUrl.isNullOrBlank()) return false

        val now = System.currentTimeMillis()
        backgroundEnrichAttemptedAt.entries.removeIf {
            now - it.value >= ARTICLE_BACKGROUND_ENRICH_RETRY_MS
        }

        val lastAttemptAt = backgroundEnrichAttemptedAt[article.id]
        if (lastAttemptAt != null && now - lastAttemptAt < ARTICLE_BACKGROUND_ENRICH_RETRY_MS) return false

        backgroundEnrichAttemptedAt[article.id] = now
        return true
    }

    private companion object {
        const val ARTICLE_ENRICH_REFRESH_DELAY_MS = 600L
        const val ARTICLE_BACKGROUND_ENRICH_RETRY_MS = 10 * 60 * 1000L
        const val NEXT_ARTICLE_WARM_LIMIT = 2
    }
}
