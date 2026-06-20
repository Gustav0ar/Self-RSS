package com.selffeed.android.ui.articles

import com.selffeed.android.data.AppResult
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.EnrichArticleResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages article enrichment (fetching full content from canonical URLs).
 * Coordinates enrichment requests, refresh delays, and cache invalidation.
 */
@Singleton
class EnrichmentManager @Inject constructor(
    private val repository: SelfFeedRepository,
) {
    private var scope: CoroutineScope? = null
    private var enrichArticleJob: Job? = null
    private var selectedArticle: ArticleDetail? = null

    fun setScope(scope: CoroutineScope) {
        this.scope = scope
    }

    fun updateSelectedArticle(article: ArticleDetail?) {
        selectedArticle = article
    }

    /**
     * Attempts to enrich the given article if conditions are met.
     * Returns immediately; enrichment happens asynchronously.
     */
    fun maybeEnrichSelectedArticle(article: ArticleDetail) {
        if (article.isEnriched || article.canonicalUrl.isNullOrBlank()) return
        enrichArticleJob?.cancel()
        enrichArticleJob = scope?.launch {
            when (repository.enrichArticle(article.id)) {
                is AppResult.Success -> {
                    delay(ARTICLE_ENRICH_REFRESH_DELAY_MS)
                    when (val refreshed = repository.article(article.id, forceRefresh = true)) {
                        is AppResult.Success -> {
                            selectedArticle = if (selectedArticle?.id == article.id) {
                                refreshed.data
                            } else {
                                selectedArticle
                            }
                        }
                        is AppResult.Error -> Unit
                    }
                }
                is AppResult.Error -> Unit
            }
        }
    }

    /**
     * Explicitly request enrichment for an article.
     * Returns immediately with a queued status.
     */
    fun enrichArticle(articleId: String): AppResult<EnrichArticleResponse> {
        scope?.launch {
            when (repository.enrichArticle(articleId)) {
                is AppResult.Success, is AppResult.Error -> Unit
            }
        }
        return AppResult.Success(EnrichArticleResponse(success = false, reason = "queued"))
    }

    /**
     * Cancels any pending enrichment job.
     */
    fun cancelEnrichment() {
        enrichArticleJob?.cancel()
        enrichArticleJob = null
    }

    private companion object {
        const val ARTICLE_ENRICH_REFRESH_DELAY_MS = 600L
    }
}
