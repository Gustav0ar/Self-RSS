package com.selffeed.android.ui

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.navigation.BackNavigationBehavior
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.selffeed.android.R
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.scene.Scene
import androidx.navigation3.ui.NavDisplay
import androidx.navigationevent.NavigationEvent
import kotlinx.serialization.Serializable

@Serializable
data object ArticleListDestination : NavKey

@Serializable
data object ArticleDetailDestination : NavKey

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
    listContent: @Composable (openReaderImmediately: () -> Unit) -> Unit,
    detailContent: @Composable (preferHtml: Boolean, onPreferHtmlChanged: (Boolean) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    val backStack = rememberNavBackStack(ArticleListDestination)
    // The detail entry represents the whole reader session, not one article.
    // Keeping this destination stable is essential: replacing its key after a
    // pager swipe disposes the pager and its WebViews, producing a visible
    // one-frame flash after the swipe has already settled.
    val isReaderOpen = selectedArticleId != null
    val openReaderImmediately: () -> Unit = remember(backStack) {
        {
            if (backStack.lastOrNull() != ArticleDetailDestination) {
                backStack.add(ArticleDetailDestination)
            }
        }
    }

    LaunchedEffect(isReaderOpen) {
        val hasDetailDestination = backStack.lastOrNull() == ArticleDetailDestination
        if (isReaderOpen == hasDetailDestination) return@LaunchedEffect

        while (backStack.size > 1) backStack.removeLastOrNull()
        if (isReaderOpen) backStack.add(ArticleDetailDestination)
    }

    val listDetailStrategy = rememberListDetailSceneStrategy<NavKey>(
        // Back closes the reader even when the detail placeholder keeps
        // the same two-pane layout.
        backNavigationBehavior = BackNavigationBehavior.PopLatest,
    )
    val forward = if (LocalLayoutDirection.current == LayoutDirection.Ltr) 1 else -1
    NavDisplay(
        backStack = backStack,
        onBack = {
            // Commit the destination change with the gesture. Waiting for
            // selection to clear lets NavDisplay briefly treat Back as cancelled.
            if (backStack.size > 1) backStack.removeLastOrNull()
            if (selectedArticleId != null) onCloseArticle()
        },
        sceneStrategies = listOf(listDetailStrategy),
        transitionSpec = { readerTransition(direction = forward, opening = true) },
        popTransitionSpec = { readerTransition(direction = forward, opening = false) },
        predictivePopTransitionSpec = { swipeEdge ->
            val direction = when (swipeEdge) {
                NavigationEvent.EDGE_LEFT -> 1
                NavigationEvent.EDGE_RIGHT -> -1
                else -> forward
            }
            readerTransition(direction = direction, opening = false)
        },
        entryProvider = entryProvider {
            entry<ArticleListDestination>(
                metadata = ListDetailSceneStrategy.listPane(
                    detailPlaceholder = { ReaderPlaceholder() },
                ),
            ) {
                listContent(openReaderImmediately)
            }
            entry<ArticleDetailDestination>(
                metadata = ListDetailSceneStrategy.detailPane(),
            ) {
                ArticleReaderSession(detailContent)
            }
        },
        modifier = modifier.clipToBounds(),
    )
}

private fun AnimatedContentTransitionScope<Scene<NavKey>>.readerTransition(
    direction: Int,
    opening: Boolean,
): ContentTransform {
    // The wide scene already moves its own panes. A window-size change can
    // also cross the compact breakpoint while a reader session is open.
    if (
        initialState.entries.size != 1 || targetState.entries.size != 1 ||
        initialState.entries.single().contentKey == targetState.entries.single().contentKey
    ) {
        return fadeIn(tween(130, easing = ReadingMotionEasing)) togetherWith fadeOut(tween(130))
    }
    val distanceIn = if (opening) 1f else -0.10f
    val distanceOut = if (opening) -0.10f else 1f
    val enter = slideInHorizontally(tween(210, easing = ReadingMotionEasing)) {
        (it * distanceIn * direction).toInt()
    }
    val exit = slideOutHorizontally(tween(210, easing = ReadingMotionEasing)) {
        (it * distanceOut * direction).toInt()
    }
    return enter togetherWith exit
}

@Composable
private fun ArticleReaderSession(
    content: @Composable (preferHtml: Boolean, onPreferHtmlChanged: (Boolean) -> Unit) -> Unit,
) {
    // The mode belongs to this detail destination's lifetime. Rich is always
    // the default, a manual Text selection survives adjacent-article swipes,
    // and closing the destination naturally resets the next session to Rich.
    var preferHtml by rememberSaveable { mutableStateOf(true) }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        content(preferHtml) { preferHtml = it }
    }
}

@Composable
private fun ReaderPlaceholder() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                stringResource(R.string.article_choose),
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                stringResource(R.string.article_choose_detail),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
