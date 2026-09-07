package com.selffeed.android.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.shape.RoundedCornerShape
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import com.selffeed.android.R
import com.selffeed.android.ui.PresentationText
import com.selffeed.android.ui.resolve

@Composable
fun SearchTab(
    state: SearchTabState,
    actions: SearchTabActions,
    observeOfflineText: (String) -> Flow<Boolean> = { emptyFlow() },
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            FeedSurfaceCard {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = {
                        actions.onQueryChanged(it)
                        if (it.trim().length >= 2) actions.onSearchRequested()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text(stringResource(R.string.search_hint)) },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = stringResource(R.string.search_articles_cd),
                        )
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(20.dp),
                )
                if (state.currentCategoryAvailable) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = !state.currentCategoryOnly,
                            onClick = { actions.onCurrentCategoryOnlyChanged(false) },
                            label = { Text(stringResource(R.string.search_scope_all)) },
                        )
                        FilterChip(
                            selected = state.currentCategoryOnly,
                            onClick = { actions.onCurrentCategoryOnlyChanged(true) },
                            label = { Text(stringResource(R.string.search_scope_current)) },
                        )
                    }
                }
            }
        }

        if (state.query.trim().length >= 2) {
            item(key = "search-status") {
                when {
                    state.loadingResults -> SearchStatus(stringResource(R.string.search_loading))
                    state.errorMessage != null && !state.hasMoreResults -> SearchFailure(
                        error = state.errorMessage,
                        onRetry = actions.onSearchRequested,
                    )
                    state.results.isEmpty() && state.errorMessage == null -> SearchStatus(
                        stringResource(
                            if (state.isOffline) R.string.search_no_cached_matches
                            else R.string.search_no_matches,
                        ),
                    )
                    state.results.isNotEmpty() -> SearchStatus(
                        pluralStringResource(
                            R.plurals.search_result_count,
                            state.results.size,
                            state.results.size,
                        ),
                    )
                }
            }
        }

        items(
            items = state.results,
            key = { it.id },
            contentType = { "search-result-row" },
        ) { article ->
            Column(modifier = Modifier.clickable { actions.onOpenArticle(article.id) }) {
                ArticleCard(
                    observeOfflineText = observeOfflineText,
                    article = article,
                    selected = state.selectedArticleId == article.id,
                    onClick = {},
                    onToggleSaved = { actions.onToggleSaved(article.id, !article.isSaved) },
                )
            }
        }

        if (state.resultLimitReached) {
            item(key = "search-result-limit") {
                Text(
                    text = stringResource(R.string.search_limit_notice, state.results.size),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }

        if (state.hasMoreResults) {
            item {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    when {
                        state.loadingMoreResults -> SearchStatus(stringResource(R.string.search_loading_more))
                        state.errorMessage != null -> SearchFailure(
                            error = state.errorMessage,
                            onRetry = actions.onLoadMore,
                        )
                        else -> TextButton(onClick = actions.onLoadMore) {
                            Text(stringResource(R.string.search_load_more))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchStatus(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 4.dp).semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
private fun SearchFailure(error: PresentationText, onRetry: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = error.resolve(),
            modifier = Modifier.weight(1f).padding(horizontal = 4.dp),
            style = MaterialTheme.typography.bodyMedium,
        )
        TextButton(onClick = onRetry) {
            Text(stringResource(R.string.action_retry))
        }
    }
}
