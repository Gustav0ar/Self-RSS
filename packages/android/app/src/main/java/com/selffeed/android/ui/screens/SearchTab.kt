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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.selffeed.android.R

@Composable
fun SearchTab(state: SearchTabState, actions: SearchTabActions) {
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
                        if (it.length >= 2) actions.onSearchRequested()
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

        item {
            if (state.query.length >= 2) {
                Text(
                    text = pluralStringResource(
                        R.plurals.search_result_count,
                        state.results.size,
                        state.results.size,
                    ),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
        }

        if (state.loadingResults && state.results.isEmpty()) {
            item(key = "search-loading") {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
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
                    article = article,
                    selected = state.selectedArticleId == article.id,
                    onClick = {},
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
                Box(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                    if (state.loadingMoreResults) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        AssistChip(
                            onClick = actions.onLoadMore,
                            label = { Text(stringResource(R.string.search_load_more)) },
                        )
                    }
                }
            }
        }
    }
}
