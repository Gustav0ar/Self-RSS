package com.selffeed.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import kotlinx.serialization.Serializable

@Serializable
data object ArticleListDestination : NavKey

@Serializable
data class ArticleDetailDestination(val articleId: String) : NavKey

/**
 * Navigation 3 owns the reader back stack. Its Material list-detail scene
 * automatically keeps the queue and reader together when there is space, and
 * falls back to a single focused destination on compact devices.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun ArticleListDetailNavigation(
    selectedArticleId: String?,
    onCloseArticle: () -> Unit,
    listContent: @Composable () -> Unit,
    detailContent: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    val backStack = rememberNavBackStack(ArticleListDestination)

    LaunchedEffect(selectedArticleId) {
        val detailDestination = selectedArticleId?.let(::ArticleDetailDestination)
        val currentDetail = backStack.lastOrNull() as? ArticleDetailDestination
        if (detailDestination == currentDetail) return@LaunchedEffect

        while (backStack.size > 1) backStack.removeLastOrNull()
        if (detailDestination != null) backStack.add(detailDestination)
    }

    val listDetailStrategy = rememberListDetailSceneStrategy<NavKey>()
    NavDisplay(
        backStack = backStack,
        onBack = {
            if (selectedArticleId != null) onCloseArticle()
            else if (backStack.size > 1) backStack.removeLastOrNull()
        },
        sceneStrategies = listOf(listDetailStrategy),
        entryProvider = entryProvider {
            entry<ArticleListDestination>(
                metadata = ListDetailSceneStrategy.listPane(
                    detailPlaceholder = { ReaderPlaceholder() },
                ),
            ) {
                listContent()
            }
            entry<ArticleDetailDestination>(
                metadata = ListDetailSceneStrategy.detailPane(),
            ) {
                detailContent()
            }
        },
        modifier = modifier,
    )
}

@Composable
private fun ReaderPlaceholder() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Choose an article", style = MaterialTheme.typography.titleMedium)
            Text(
                "Its reader will appear here.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
