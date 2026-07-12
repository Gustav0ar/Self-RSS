package com.selffeed.android.ui.screens

import android.content.Context
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.RssFeed
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.selffeed.android.network.ArticleListItem
import com.selffeed.android.network.AuthSession
import com.selffeed.android.network.CategoryWithCounts
import com.selffeed.android.network.FeedWithCounts
import com.selffeed.android.network.OpmlImportSummary
import com.selffeed.android.network.StatsResponse
import com.selffeed.android.network.UserPreferences
import com.selffeed.android.ui.ArticleSortPreference
import com.selffeed.android.ui.AutoMarkReadPreference
import com.selffeed.android.ui.DensityPreference
import com.selffeed.android.ui.ReaderFontPreference
import com.selffeed.android.ui.ThemePreference
import com.selffeed.android.ui.theme.WarningAmber
import com.selffeed.android.ui.utils.formatPublishedAt
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged
import java.io.ByteArrayOutputStream

data class FeedTabState(
    val categories: List<CategoryWithCounts>,
    val feeds: List<FeedWithCounts>,
    val hideRead: Boolean,
    val totalUnread: Int,
    val selectedCategoryId: String?,
    val selectedFeedId: String?,
    val loading: Boolean = false,
    val lastImportSummary: OpmlImportSummary? = null,
)

data class ArticleTabState(
    val articles: List<ArticleListItem>,
    val selectedArticleId: String?,
    val hasMoreArticles: Boolean,
    val loadingMoreArticles: Boolean,
    val isSyncingFeeds: Boolean,
    val density: DensityPreference = DensityPreference.COMFORTABLE,
    val isOffline: Boolean = false,
    val feedCount: Int = 0,
)

data class SearchTabState(
    val query: String,
    val results: List<ArticleListItem>,
    val selectedArticleId: String?,
    val hasMoreResults: Boolean,
    val loadingResults: Boolean,
    val loadingMoreResults: Boolean,
    val currentCategoryAvailable: Boolean,
    val currentCategoryOnly: Boolean,
    val resultLimitReached: Boolean,
)

data class SettingsTabState(
    val preferences: UserPreferences?,
    val stats: StatsResponse?,
    val authSessions: List<AuthSession>,
)

data class FeedTabActions(
    val onHideReadChanged: (Boolean) -> Unit,
    val onCategorySelected: (String?) -> Unit,
    val onFeedSelected: (String?) -> Unit,
    val onCreateCategory: (String, String?) -> Unit = { _, _ -> },
    val onUpdateCategory: (String, String, String?) -> Unit = { _, _, _ -> },
    val onDeleteCategory: (String) -> Unit = {},
    val onCreateFeed: (String, String, String?) -> Unit = { _, _, _ -> },
    val onUpdateFeed: (String, String?, String?, Int?) -> Unit = { _, _, _, _ -> },
    val onDeleteFeed: (String) -> Unit = {},
    val onImportOpml: (String, ByteArray) -> Unit = { _, _ -> },
    val onExportOpml: () -> Unit = {},
    val onDismissImportSummary: () -> Unit = {},
)

private sealed interface FeedManagementDialog {
    data class CategoryEditor(val category: CategoryWithCounts?) : FeedManagementDialog
    data class FeedEditor(val feed: FeedWithCounts?) : FeedManagementDialog
    data class DeleteCategory(val category: CategoryWithCounts) : FeedManagementDialog
    data class DeleteFeed(val feed: FeedWithCounts) : FeedManagementDialog
}

data class ArticleTabActions(
    val onRefresh: () -> Unit,
    val onLoadMore: () -> Unit,
    val onOpenArticle: (String) -> Unit,
    val onToggleRead: (String, Boolean) -> Unit,
    val onReadStateChanged: (String, Boolean) -> Unit = { _, _ -> },
    val onArticleSnapshot: (List<ArticleListItem>) -> Unit,
)

data class SearchTabActions(
    val onQueryChanged: (String) -> Unit,
    val onSearchRequested: () -> Unit,
    val onOpenArticle: (String) -> Unit,
    val onLoadMore: () -> Unit,
    val onCurrentCategoryOnlyChanged: (Boolean) -> Unit,
)

internal sealed interface FeedDrawerRow {
    val depth: Int
    val key: String
    val contentType: String
}

internal data class CategoryDrawerRow(
    val category: CategoryWithCounts,
    override val depth: Int,
) : FeedDrawerRow {
    override val key = "cat-${category.id}"
    override val contentType = "category"
}

internal data class FeedDrawerFeedRow(
    val feed: FeedWithCounts,
    override val depth: Int,
) : FeedDrawerRow {
    override val key = "feed-${feed.id}"
    override val contentType = "feed"
}

internal fun buildFeedDrawerRows(
    categories: List<CategoryWithCounts>,
    feedsByCategory: Map<String, List<FeedWithCounts>>,
    isExpanded: (String) -> Boolean,
): List<FeedDrawerRow> = buildList {
    fun addCategory(category: CategoryWithCounts, depth: Int) {
        add(CategoryDrawerRow(category, depth))
        if (!isExpanded(category.id)) return

        feedsByCategory[category.id].orEmpty().forEach { feed ->
            add(FeedDrawerFeedRow(feed, depth + 1))
        }
        category.children.orEmpty().forEach { child ->
            addCategory(child, depth + 1)
        }
    }

    categories.forEach { category -> addCategory(category, depth = 0) }
}

data class SettingsTabActions(
    val onThemeChanged: (ThemePreference) -> Unit,
    val onHideReadChanged: (Boolean) -> Unit,
    val onSortChanged: (ArticleSortPreference) -> Unit,
    val onDensityChanged: (DensityPreference) -> Unit,
    val onTextSizeChanged: (Int) -> Unit,
    val onFontChanged: (ReaderFontPreference) -> Unit = {},
    val onAutoMarkReadModeChanged: (AutoMarkReadPreference) -> Unit = {},
    val onRevokeAuthSession: (String) -> Unit,
    val onLogout: () -> Unit,
)

@Composable
fun FeedsTab(
    state: FeedTabState,
    actions: FeedTabActions,
    onSelect: () -> Unit = {},
) {
    val context = LocalContext.current
    val expandedCategories = remember { mutableStateMapOf<String, Boolean>() }
    var managementDialog by remember { mutableStateOf<FeedManagementDialog?>(null) }
    var importError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.categories) {
        fun seed(category: CategoryWithCounts) {
            if (!expandedCategories.containsKey(category.id)) {
                expandedCategories[category.id] = true
            }
            category.children.orEmpty().forEach(::seed)
        }
        state.categories.forEach(::seed)
    }
    val feedsByCategory = remember(state.feeds) {
        state.feeds.groupBy { it.categoryId }
    }
    val allCategories = remember(state.categories) { state.categories.flattenCategories() }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val contents = readBoundedOpml(context, uri)
        if (contents == null) {
            importError = "Unable to read that OPML file. Choose a file smaller than 5 MB."
        } else {
            actions.onImportOpml(uri.lastPathSegment?.substringAfterLast('/') ?: "feeds.opml", contents)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            FeedSurfaceCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Unread only",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Switch(
                        checked = state.hideRead,
                        onCheckedChange = actions.onHideReadChanged,
                    )
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text(
                    text = "Manage subscriptions",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { managementDialog = FeedManagementDialog.FeedEditor(feed = null) },
                        enabled = allCategories.isNotEmpty() && !state.loading,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Add feed")
                    }
                    OutlinedButton(
                        onClick = { managementDialog = FeedManagementDialog.CategoryEditor(category = null) },
                        enabled = !state.loading,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Category")
                    }
                }
                if (allCategories.isEmpty()) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Create a category before adding a feed.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { importLauncher.launch(arrayOf("application/xml", "text/xml", "text/x-opml", "application/octet-stream")) },
                        enabled = !state.loading,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Default.FileUpload, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Import OPML")
                    }
                    OutlinedButton(
                        onClick = actions.onExportOpml,
                        enabled = !state.loading,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Default.FileDownload, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Export OPML")
                    }
                }
            }
        }

        item {
            FeedSurfaceCard {
                DrawerItem(
                    icon = { Icon(Icons.Default.RssFeed, null, modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary) },
                    label = "All Feeds",
                    subtitle = "Everything in one stream",
                    count = state.totalUnread,
                    selected = state.selectedCategoryId == null && state.selectedFeedId == null,
                    onClick = {
                        actions.onCategorySelected(null)
                        onSelect()
                    },
                )
            }
        }

        val rows = buildFeedDrawerRows(
            categories = state.categories,
            feedsByCategory = feedsByCategory,
            isExpanded = { categoryId -> expandedCategories[categoryId] ?: true },
        )
        items(
            items = rows,
            key = { row -> row.key },
            contentType = { row -> row.contentType },
        ) { row ->
            when (row) {
                is CategoryDrawerRow -> {
                    val category = row.category
                    val isExpanded = expandedCategories[category.id] ?: true
                    FeedSurfaceCard(modifier = Modifier.padding(start = (row.depth * 14).dp)) {
                        DrawerItem(
                            icon = {
                                Icon(
                                    if (isExpanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                                    null,
                                    modifier = Modifier.size(20.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            },
                            label = category.name,
                            subtitle = "${category.feedCount} feeds",
                            count = category.unreadCount,
                            selected = state.selectedCategoryId == category.id,
                            onClick = {
                                actions.onCategorySelected(category.id)
                                onSelect()
                            },
                            onExpand = {
                                expandedCategories[category.id] = !isExpanded
                            },
                            onEdit = { managementDialog = FeedManagementDialog.CategoryEditor(category) },
                            onDelete = { managementDialog = FeedManagementDialog.DeleteCategory(category) },
                        )
                    }
                }
                is FeedDrawerFeedRow -> {
                    FeedRow(
                        feed = row.feed,
                        selected = state.selectedFeedId == row.feed.id,
                        modifier = Modifier.padding(start = (row.depth * 14).dp),
                        onSelect = {
                            actions.onFeedSelected(row.feed.id)
                            onSelect()
                        },
                        onEdit = { managementDialog = FeedManagementDialog.FeedEditor(row.feed) },
                        onDelete = { managementDialog = FeedManagementDialog.DeleteFeed(row.feed) },
                    )
                }
            }
        }
    }

    when (val dialog = managementDialog) {
        is FeedManagementDialog.CategoryEditor -> CategoryEditorDialog(
            category = dialog.category,
            availableParents = allCategories.filterNot { candidate ->
                dialog.category?.let { candidate.id in it.descendantIds() } == true
            },
            onDismiss = { managementDialog = null },
            onSave = { name, parentCategoryId ->
                val category = dialog.category
                if (category == null) {
                    actions.onCreateCategory(name, parentCategoryId)
                } else {
                    actions.onUpdateCategory(category.id, name, parentCategoryId)
                }
                managementDialog = null
            },
        )
        is FeedManagementDialog.FeedEditor -> FeedEditorDialog(
            feed = dialog.feed,
            categories = allCategories,
            onDismiss = { managementDialog = null },
            onSave = { url, title, categoryId, pollingIntervalMinutes ->
                val feed = dialog.feed
                if (feed == null) {
                    actions.onCreateFeed(url, categoryId, title)
                } else {
                    actions.onUpdateFeed(feed.id, title, categoryId, pollingIntervalMinutes)
                }
                managementDialog = null
            },
        )
        is FeedManagementDialog.DeleteCategory -> DeleteConfirmationDialog(
            title = "Delete category?",
            message = "Delete \"${dialog.category.name}\" and its organization? Feeds in the category may also be removed.",
            confirmLabel = "Delete category",
            onDismiss = { managementDialog = null },
            onConfirm = {
                actions.onDeleteCategory(dialog.category.id)
                managementDialog = null
            },
        )
        is FeedManagementDialog.DeleteFeed -> DeleteConfirmationDialog(
            title = "Remove feed?",
            message = "Remove \"${dialog.feed.title}\" and its saved articles from this device?",
            confirmLabel = "Remove feed",
            onDismiss = { managementDialog = null },
            onConfirm = {
                actions.onDeleteFeed(dialog.feed.id)
                managementDialog = null
            },
        )
        null -> Unit
    }

    state.lastImportSummary?.let { summary ->
        OpmlImportSummaryDialog(summary = summary, onDismiss = actions.onDismissImportSummary)
    }
    importError?.let { message ->
        AlertDialog(
            onDismissRequest = { importError = null },
            confirmButton = { TextButton(onClick = { importError = null }) { Text("OK") } },
            title = { Text("OPML import") },
            text = { Text(message) },
        )
    }
}

@Composable
fun FeedSurfaceCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(10.dp),
            content = content,
        )
    }
}

@Composable
private fun CategoryEditorDialog(
    category: CategoryWithCounts?,
    availableParents: List<CategoryWithCounts>,
    onDismiss: () -> Unit,
    onSave: (name: String, parentCategoryId: String?) -> Unit,
) {
    var name by remember(category?.id) { mutableStateOf(category?.name.orEmpty()) }
    var parentCategoryId by remember(category?.id) { mutableStateOf(category?.parentCategoryId) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (category == null) "New category" else "Edit category") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                CategoryPicker(
                    label = "Parent category",
                    categoryId = parentCategoryId,
                    categories = availableParents,
                    includeRoot = true,
                    onCategorySelected = { parentCategoryId = it },
                )
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        confirmButton = {
            TextButton(
                enabled = name.trim().isNotEmpty(),
                onClick = { onSave(name.trim(), parentCategoryId) },
            ) { Text("Save") }
        },
    )
}

@Composable
private fun FeedEditorDialog(
    feed: FeedWithCounts?,
    categories: List<CategoryWithCounts>,
    onDismiss: () -> Unit,
    onSave: (url: String, title: String?, categoryId: String, pollingIntervalMinutes: Int?) -> Unit,
) {
    var url by remember(feed?.id) { mutableStateOf(feed?.feedUrl.orEmpty()) }
    var title by remember(feed?.id) { mutableStateOf(feed?.title.orEmpty()) }
    var categoryId by remember(feed?.id) { mutableStateOf(feed?.categoryId ?: categories.firstOrNull()?.id.orEmpty()) }
    var pollingInterval by remember(feed?.id) { mutableStateOf(feed?.pollingIntervalMinutes?.toString().orEmpty()) }
    val validInterval = pollingInterval.toIntOrNull()?.takeIf { it in 5..1440 }
    val canSave = categoryId.isNotBlank() && if (feed == null) url.trim().isNotEmpty() else validInterval != null

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (feed == null) "Add feed" else "Edit feed") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (feed == null) {
                    OutlinedTextField(
                        value = url,
                        onValueChange = { url = it },
                        label = { Text("Feed URL") },
                        supportingText = { Text("Paste an RSS, Atom, or JSON Feed URL") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    Text(
                        text = feed.feedUrl,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Display name (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                CategoryPicker(
                    label = "Category",
                    categoryId = categoryId,
                    categories = categories,
                    onCategorySelected = { categoryId = it.orEmpty() },
                )
                if (feed != null) {
                    OutlinedTextField(
                        value = pollingInterval,
                        onValueChange = { pollingInterval = it.filter(Char::isDigit) },
                        label = { Text("Refresh interval (minutes)") },
                        supportingText = { Text("5 to 1,440 minutes") },
                        isError = pollingInterval.isNotEmpty() && validInterval == null,
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        confirmButton = {
            TextButton(
                enabled = canSave,
                onClick = { onSave(url.trim(), title.trim().ifBlank { null }, categoryId, validInterval) },
            ) { Text(if (feed == null) "Add" else "Save") }
        },
    )
}

@Composable
private fun CategoryPicker(
    label: String,
    categoryId: String?,
    categories: List<CategoryWithCounts>,
    includeRoot: Boolean = false,
    onCategorySelected: (String?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = categories.firstOrNull { it.id == categoryId }?.name
        ?: if (includeRoot) "No parent (top level)" else "Choose a category"
    Box {
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Text("$label: $selectedLabel", maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (includeRoot) {
                DropdownMenuItem(
                    text = { Text("No parent (top level)") },
                    onClick = {
                        onCategorySelected(null)
                        expanded = false
                    },
                )
            }
            categories.forEach { category ->
                DropdownMenuItem(
                    text = { Text(category.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    onClick = {
                        onCategorySelected(category.id)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun DeleteConfirmationDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel) } },
    )
}

@Composable
private fun OpmlImportSummaryDialog(summary: OpmlImportSummary, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("OPML imported") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Added ${summary.createdFeeds} feeds in ${summary.createdCategories} categories.")
                if (summary.skippedDuplicates > 0) Text("Skipped ${summary.skippedDuplicates} duplicates.")
                if (summary.invalidEntries > 0) Text("Skipped ${summary.invalidEntries} invalid entries.")
                summary.warnings.take(2).forEach { warning ->
                    Text(
                        text = warning.message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}

private fun List<CategoryWithCounts>.flattenCategories(): List<CategoryWithCounts> = buildList {
    fun visit(category: CategoryWithCounts) {
        add(category)
        category.children.orEmpty().forEach(::visit)
    }
    forEach(::visit)
}

private fun CategoryWithCounts.descendantIds(): Set<String> = buildSet {
    fun visit(category: CategoryWithCounts) {
        add(category.id)
        category.children.orEmpty().forEach(::visit)
    }
    visit(this@descendantIds)
}

private fun readBoundedOpml(context: Context, uri: Uri): ByteArray? = try {
    context.contentResolver.openInputStream(uri)?.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            total += read
            if (total > MAX_OPML_BYTES) return null
            output.write(buffer, 0, read)
        }
        output.toByteArray()
    }
} catch (_: Exception) {
    null
}

private const val MAX_OPML_BYTES = 5 * 1024 * 1024

@Composable
private fun DrawerItem(
    icon: @Composable () -> Unit,
    label: String,
    subtitle: String,
    count: Int,
    selected: Boolean = false,
    onClick: () -> Unit,
    onExpand: (() -> Unit)? = null,
    onEdit: (() -> Unit)? = null,
    onDelete: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .then(if (onExpand != null) Modifier.clickable(onClick = onExpand) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            icon()
        }
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(text = subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (count > 0) {
            Surface(shape = CircleShape, color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant) {
                Text(
                    text = count.toString(),
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (onEdit != null || onDelete != null) {
            FeedOverflowMenu(onEdit = onEdit, onDelete = onDelete)
        }
    }
}

@Composable
private fun FeedOverflowMenu(onEdit: (() -> Unit)?, onDelete: (() -> Unit)?) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Default.MoreVert, contentDescription = "More options")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            onEdit?.let { edit ->
                DropdownMenuItem(
                    text = { Text("Edit") },
                    leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                    onClick = {
                        expanded = false
                        edit()
                    },
                )
            }
            onDelete?.let { delete ->
                DropdownMenuItem(
                    text = { Text("Remove") },
                    leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                    onClick = {
                        expanded = false
                        delete()
                    },
                )
            }
        }
    }
}

@Composable
private fun FeedRow(
    feed: FeedWithCounts,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onSelect: () -> Unit,
    onEdit: (() -> Unit)? = null,
    onDelete: (() -> Unit)? = null,
) {
    val syncWarning = feedSyncWarning(feed)
    val subtitle = syncWarning ?: feed.description ?: feed.feedUrl
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
            .clickable(onClick = onSelect)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = feed.faviconUrl,
            contentDescription = "Feed icon for ${feed.title}",
            modifier = Modifier
                .size(24.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentScale = ContentScale.Crop,
        )
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = feed.title,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                    color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (syncWarning != null) {
                    Spacer(modifier = Modifier.width(4.dp))
                    Icon(
                        Icons.Default.Warning,
                        contentDescription = syncWarning,
                        modifier = Modifier.size(14.dp),
                        tint = WarningAmber,
                    )
                }
            }
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = if (syncWarning != null) WarningAmber else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (feed.unreadCount > 0) {
            Surface(
                shape = CircleShape,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            ) {
                Text(
                    text = feed.unreadCount.toString(),
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (onEdit != null || onDelete != null) {
            FeedOverflowMenu(onEdit = onEdit, onDelete = onDelete)
        }
    }
}

internal fun feedSyncWarning(feed: FeedWithCounts): String? {
    if (feed.syncStatus != "error" && feed.lastSyncError.isNullOrBlank()) return null
    val detail = feed.lastSyncError?.trim()?.takeIf { it.isNotEmpty() } ?: "Latest refresh failed"
    return "${feed.title} is not updating. $detail"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticlesTab(
    state: ArticleTabState,
    actions: ArticleTabActions,
    pagedArticles: LazyPagingItems<ArticleListItem>? = null,
) {
    val listState = rememberLazyListState()
    val pullToRefreshState = rememberPullToRefreshState()
    val density = LocalDensity.current
    var keepTopAfterRefresh by remember { mutableStateOf(false) }
    var wasRefreshing by remember { mutableStateOf(false) }
    val readStateOverrides = remember(state.articles) {
        state.articles.associate { it.id to it.isRead }
    }

    LaunchedEffect(
        listState,
        pagedArticles,
        state.articles.size,
        state.hasMoreArticles,
        state.loadingMoreArticles,
    ) {
        if (pagedArticles != null) return@LaunchedEffect
        snapshotFlow {
            val lastVisibleIndex = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            state.hasMoreArticles &&
                !state.loadingMoreArticles &&
                state.articles.isNotEmpty() &&
                lastVisibleIndex >= state.articles.lastIndex - AUTO_LOAD_MORE_THRESHOLD
        }
            .distinctUntilChanged()
            .collect { shouldLoadMore ->
                if (shouldLoadMore) {
                    actions.onLoadMore()
                }
            }
    }

    val isPagingInitialLoad = pagedArticles?.loadState?.refresh is LoadState.Loading
    val articleCount = pagedArticles?.itemCount ?: state.articles.size
    val isRefreshing = isPagingInitialLoad && articleCount > 0
    val isEmpty = articleCount == 0 && !isPagingInitialLoad && !isRefreshing && !state.isSyncingFeeds

    LaunchedEffect(isRefreshing, articleCount) {
        if (!wasRefreshing && isRefreshing && listState.firstVisibleItemIndex == 0) {
            keepTopAfterRefresh = true
        }
        if (wasRefreshing && !isRefreshing && keepTopAfterRefresh && articleCount > 0) {
            listState.scrollToItem(0)
            keepTopAfterRefresh = false
        }
        wasRefreshing = isRefreshing
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            keepTopAfterRefresh = listState.firstVisibleItemIndex == 0
            actions.onRefresh()
        },
        modifier = Modifier.fillMaxSize(),
        state = pullToRefreshState,
        indicator = {
            // Use the default Material3 indicator in both states. It
            // owns the animation (arc sweep + global rotation) and the
            // pull-arrow transition. Do NOT wrap it in a custom Box
            // with `pullToRefreshIndicator` and then place a second
            // `CircularProgressIndicator` inside that Box — the second
            // indicator overlays the default one and the two together
            // render as a single static dot, which is what the user
            // sees as a "frozen spinner" during refresh.
            PullToRefreshDefaults.Indicator(
                modifier = Modifier.align(Alignment.TopCenter),
                isRefreshing = isRefreshing,
                state = pullToRefreshState,
                containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                color = MaterialTheme.colorScheme.primary,
            )
        },
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val progress = pullToRefreshState.distanceFraction
                    if (progress > 0f) {
                        // Create the "rubber band" effect by offsetting and scaling the list
                        translationY = with(density) {
                            val offset = if (progress <= 1f) {
                                progress * 80.dp.toPx()
                            } else {
                                // Resistive pull beyond threshold
                                80.dp.toPx() + (progress - 1f) * 24.dp.toPx()
                            }
                            offset
                        }

                        val scale = 1f + (progress * 0.01f).coerceAtMost(0.015f)
                        scaleX = scale
                        scaleY = scale
                    }
                },
            verticalArrangement = Arrangement.Top,
        ) {
            if (state.isOffline) {
                item(key = "articles-offline-status") {
                    OfflineArticlesBanner()
                }
            }

            if (state.isSyncingFeeds) {
                item(key = "articles-background-sync") {
                    FeedRefreshBanner()
                }
            }

            if (isPagingInitialLoad && articleCount == 0) {
                item(key = "articles-loading") {
                    Box(
                        modifier = Modifier
                            .fillParentMaxSize()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
                    }
                }
            }

            if (isEmpty) {
                item(key = "articles-empty") {
                    Box(
                        modifier = Modifier
                            .fillParentMaxSize()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Icon(
                                imageVector = Icons.Default.MarkEmailRead,
                                contentDescription = "No articles",
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = if (state.feedCount == 0) "Start by adding a feed" else "No articles left to read",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = if (state.feedCount == 0) {
                                    "Open Feeds to add a subscription or import an OPML file."
                                } else {
                                    "Your queue is empty. Pull down to refresh or check other feeds."
                                },
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }

            if (pagedArticles != null) {
                items(
                    count = pagedArticles.itemCount,
                    // `peek` does not trigger a load on the paging source;
                    // calling `pagedArticles[index]` instead forces a load
                    // and is paid for twice (once here, once in the body).
                    key = { index -> pagedArticles.peek(index)?.id ?: "article-placeholder-$index" },
                    contentType = { index ->
                        if (pagedArticles.peek(index) == null) "article-placeholder"
                        else "article-row"
                    },
                ) { index ->
                    val article = pagedArticles[index]
                    if (article == null) {
                        ArticlePlaceholderRow()
                    } else {
                        val isRead = readStateOverrides[article.id] ?: article.isRead
                        ArticleListRow(
                            article = article,
                            isRead = isRead,
                            selected = state.selectedArticleId == article.id,
                            onClick = {
                                actions.onArticleSnapshot(pagedArticles.itemSnapshotList.items)
                                actions.onOpenArticle(article.id)
                            },
                            onToggleRead = { read ->
                                actions.onArticleSnapshot(pagedArticles.itemSnapshotList.items)
                                actions.onToggleRead(article.id, read)
                                actions.onReadStateChanged(article.id, !read)
                            },
                            density = state.density,
                        )
                    }
                }

                val appendLoadState = pagedArticles.loadState.append
                if (appendLoadState is LoadState.Loading || appendLoadState is LoadState.Error) {
                    item(key = "articles-paging-footer") {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 16.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (appendLoadState is LoadState.Loading) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                            } else if (appendLoadState is LoadState.Error) {
                                AssistChip(
                                    onClick = pagedArticles::retry,
                                    label = { Text(appendLoadState.error.message ?: "Retry loading") },
                                )
                            }
                        }
                    }
                }

                val refreshLoadState = pagedArticles.loadState.refresh
                if (refreshLoadState is LoadState.Error && pagedArticles.itemCount == 0) {
                    item(key = "articles-refresh-error") {
                        Box(
                            modifier = Modifier
                                .fillParentMaxSize()
                                .padding(32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            AssistChip(
                                onClick = pagedArticles::retry,
                                label = { Text(refreshLoadState.error.message ?: "Retry") },
                            )
                        }
                    }
                }
            } else {
                items(
                    items = state.articles,
                    key = { it.id },
                    contentType = { "article-row" },
                ) { article ->
                    ArticleListRow(
                        article = article,
                        isRead = article.isRead,
                        selected = state.selectedArticleId == article.id,
                        onClick = { actions.onOpenArticle(article.id) },
                        onToggleRead = { read ->
                            actions.onToggleRead(article.id, read)
                            actions.onReadStateChanged(article.id, !read)
                        },
                        density = state.density,
                    )
                }

                if (state.hasMoreArticles) {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp), contentAlignment = Alignment.Center) {
                            if (state.loadingMoreArticles) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                            } else {
                                AssistChip(
                                    onClick = actions.onLoadMore,
                                    label = { Text("Load more") },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OfflineArticlesBanner() {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = RoundedCornerShape(16.dp),
    ) {
        Text(
            text = "Offline — showing saved articles. Read changes will sync when you reconnect.",
            modifier = Modifier.padding(12.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}

@Composable
private fun FeedRefreshBanner() {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = MaterialTheme.colorScheme.primaryContainer,
        shape = RoundedCornerShape(16.dp),
    ) {
        Text(
            text = "Refreshing feeds in the background. New articles will appear as they arrive.",
            modifier = Modifier.padding(12.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun ArticleListRow(
    article: ArticleListItem,
    isRead: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
    onToggleRead: (Boolean) -> Unit,
    density: DensityPreference,
) {
    val dismissState = rememberSwipeToDismissBoxState()
    var pendingToggle by remember { mutableStateOf(false) }
    // Snapshot the read state at the moment the user started the swipe so
    // a fast double-swipe (or a recomposition that flips `isRead`) cannot
    // toggle the article twice in a row.
    val readAtSwipeStart = remember { mutableStateOf(isRead) }

    LaunchedEffect(dismissState.currentValue) {
        if (dismissState.currentValue == SwipeToDismissBoxValue.EndToStart && !pendingToggle) {
            readAtSwipeStart.value = isRead
            pendingToggle = true
            delay(250)
            onToggleRead(!readAtSwipeStart.value)
            dismissState.reset()
            pendingToggle = false
        }
    }

    val effectiveIsRead = if (pendingToggle) !isRead else isRead

    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            val color = if (effectiveIsRead) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary
            val icon = if (effectiveIsRead) Icons.Default.MarkEmailUnread else Icons.Default.MarkEmailRead
            val label = if (effectiveIsRead) "Mark unread" else "Mark read"

            Box(
                Modifier
                    .fillMaxSize()
                    .background(color.copy(alpha = 0.9f))
                    .padding(horizontal = 24.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.graphicsLayer {
                        this.alpha = (dismissState.progress * 2f - 1f).coerceIn(0f, 1f)
                        this.translationX = (1f - dismissState.progress) * 100f
                    },
                ) {
                    Text(
                        text = label,
                        color = Color.White,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.scale(dismissState.progress.coerceIn(0.8f, 1.2f)),
                    )
                }
            }
        },
    ) {
        val readState = if (effectiveIsRead) "Read" else "Unread"
        Column(
            modifier = Modifier
                .semantics { contentDescription = "$readState article: ${article.title}, from ${article.feedTitle}" }
                .clickable(onClick = onClick),
        ) {
            ArticleCard(
                article = article,
                selected = selected,
                onClick = {}, // click handled by parent Column
                isReadOverride = effectiveIsRead,
                density = density,
            )
            HorizontalDivider(
                modifier = Modifier.padding(horizontal = 16.dp),
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f),
            )
        }
    }
}

@Composable
private fun ArticlePlaceholderRow() {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .weight(1f, fill = true)
                    .widthIn(min = 0.dp),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.35f)
                        .height(12.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
                Spacer(modifier = Modifier.height(8.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(18.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
                Spacer(modifier = Modifier.height(6.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.72f)
                        .height(14.dp)
                        .clip(RoundedCornerShape(7.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f)),
                )
            }
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            )
        }
    }
}

@Composable
private fun ArticleCard(
    article: ArticleListItem,
    selected: Boolean,
    onClick: () -> Unit,
    isReadOverride: Boolean? = null,
    density: DensityPreference = DensityPreference.COMFORTABLE,
) {
    val isRead = isReadOverride ?: article.isRead
    val verticalPadding = if (density == DensityPreference.COMPACT) 8.dp else 12.dp
    val heroSize = if (density == DensityPreference.COMPACT) 44.dp else 56.dp
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else MaterialTheme.colorScheme.background,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(if (isRead && !selected) 0.6f else 1f)
                .padding(horizontal = 16.dp, vertical = verticalPadding),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Text column. The `widthIn(min = 0)` lets Compose shrink
            // the column below its intrinsic width when the row gets
            // narrow (small phones, large text-size), so the title
            // and date can wrap to multiple lines instead of being
            // clipped. Without this guard, narrow screens render the
            // text as "7 GB" + clipped fragments like "Co" / "Pli" /
            // "Vi" at the right edge.
            Column(
                modifier = Modifier
                    .weight(1f, fill = true)
                    .widthIn(min = 0.dp),
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (!isRead) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary),
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                        }
                        Text(
                            text = article.feedTitle,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = true),
                        )
                    }
                    Text(
                        text = formatPublishedAt(article.displayedAt ?: article.publishedAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.padding(start = if (isRead) 0.dp else 14.dp),
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = article.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (isRead) FontWeight.Normal else FontWeight.SemiBold,
                    color = if (isRead && !selected) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                maxLines = if (density == DensityPreference.COMPACT) 2 else 3,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = MaterialTheme.typography.titleMedium.lineHeight * 0.9f,
                )
                article.excerpt?.takeIf { it.isNotBlank() }?.let {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                        maxLines = if (density == DensityPreference.COMPACT) 1 else 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            // Hero image. Sized to 56dp instead of 72dp so the text
            // column has at least 56 + 16 (gap) = 72 more dp on small
            // screens. Hidden entirely when the article has no image
            // URL, which is the common case for older feed entries.
            article.heroImageUrl?.let { imageUrl ->
                val context = LocalContext.current
                val imageSizePx = with(LocalDensity.current) { heroSize.roundToPx() }
                val imageRequest = remember(context, imageUrl, imageSizePx) {
                    ImageRequest.Builder(context)
                        .data(imageUrl)
                        .size(imageSizePx)
                        .memoryCachePolicy(CachePolicy.ENABLED)
                        .diskCachePolicy(CachePolicy.ENABLED)
                        .build()
                }
                AsyncImage(
                    model = imageRequest,
                    contentDescription = null,
                    modifier = Modifier
                        .size(heroSize)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentScale = ContentScale.Crop,
                )
            }
        }
    }
}

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
                    placeholder = { Text("Search titles and article content") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = "Search articles") },
                    singleLine = true,
                    shape = RoundedCornerShape(20.dp),
                )
                if (state.currentCategoryAvailable) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = !state.currentCategoryOnly,
                            onClick = { actions.onCurrentCategoryOnlyChanged(false) },
                            label = { Text("All") },
                        )
                        FilterChip(
                            selected = state.currentCategoryOnly,
                            onClick = { actions.onCurrentCategoryOnlyChanged(true) },
                            label = { Text("Current") },
                        )
                    }
                }
            }
        }

        item {
            if (state.query.length >= 2) {
                Text(
                    text = "${state.results.size} results",
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
                        .fillParentMaxWidth()
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
                    text = "Showing first ${state.results.size} results. Refine the search to narrow them.",
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
                        AssistChip(onClick = actions.onLoadMore, label = { Text("Load more results") })
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsTab(state: SettingsTabState, actions: SettingsTabActions) {
    val prefs = state.preferences ?: return
    val selectedTheme = ThemePreference.fromApiValue(prefs.theme)
    val selectedSort = ArticleSortPreference.fromApiValue(prefs.defaultSort)
    val selectedDensity = DensityPreference.fromApiValue(prefs.density)
    val selectedFont = ReaderFontPreference.fromApiValue(prefs.fontFamily)
    val selectedAutoMark = AutoMarkReadPreference.fromApiValue(prefs.autoMarkReadMode)
    var draftTextSize by remember(prefs.textSize) { mutableIntStateOf(prefs.textSize) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            FeedSurfaceCard {
                Text("Preferences", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    "Control theme, density, sorting, and whether read items stay visible in your queue.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        item {
            FeedSurfaceCard {
                Text("Reader font", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ReaderFontPreference.entries.chunked(2).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            row.forEach { option ->
                                FilterChip(
                                    selected = selectedFont == option,
                                    onClick = { actions.onFontChanged(option) },
                                    label = { Text(option.label) },
                                )
                            }
                        }
                    }
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Theme", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedTheme == ThemePreference.LIGHT, onClick = { actions.onThemeChanged(ThemePreference.LIGHT) }, label = { Text("Light") }, leadingIcon = { Icon(Icons.Outlined.LightMode, contentDescription = "Toggle light mode") })
                    FilterChip(selected = selectedTheme == ThemePreference.DARK, onClick = { actions.onThemeChanged(ThemePreference.DARK) }, label = { Text("Dark") }, leadingIcon = { Icon(Icons.Outlined.DarkMode, contentDescription = "Toggle dark mode") })
                    FilterChip(selected = selectedTheme == ThemePreference.SYSTEM, onClick = { actions.onThemeChanged(ThemePreference.SYSTEM) }, label = { Text("System") })
                }
            }
        }

        item {
            FeedSurfaceCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Hide read articles", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text("Keep the main queue focused on unread items.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = prefs.hideRead, onCheckedChange = actions.onHideReadChanged)
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Sort order", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedSort == ArticleSortPreference.LATEST, onClick = { actions.onSortChanged(ArticleSortPreference.LATEST) }, label = { Text("Newest") })
                    FilterChip(selected = selectedSort == ArticleSortPreference.OLDEST, onClick = { actions.onSortChanged(ArticleSortPreference.OLDEST) }, label = { Text("Oldest") })
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Density", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedDensity == DensityPreference.COMFORTABLE, onClick = { actions.onDensityChanged(DensityPreference.COMFORTABLE) }, label = { Text("Comfortable") })
                    FilterChip(selected = selectedDensity == DensityPreference.COMPACT, onClick = { actions.onDensityChanged(DensityPreference.COMPACT) }, label = { Text("Compact") })
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Reader text size", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                androidx.compose.material3.Slider(
                    value = draftTextSize.toFloat(),
                    onValueChange = { draftTextSize = it.roundToInt() },
                    onValueChangeFinished = { actions.onTextSizeChanged(draftTextSize) },
                    valueRange = 12f..24f,
                )
                Text("${draftTextSize}sp", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        item {
            FeedSurfaceCard {
                Text("Auto-mark as read", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    "Choose when reading should change an article's state.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    AutoMarkReadPreference.entries.forEach { option ->
                        FilterChip(
                            selected = selectedAutoMark == option,
                            onClick = { actions.onAutoMarkReadModeChanged(option) },
                            label = {
                                Text(
                                    when (option) {
                                        AutoMarkReadPreference.DISABLED -> "Disabled"
                                        AutoMarkReadPreference.ON_NAVIGATE -> "When navigating"
                                        AutoMarkReadPreference.ON_OPEN -> "When content opens"
                                    },
                                )
                            },
                        )
                    }
                }
            }
        }

        item {
            FeedSurfaceCard {
                Text("Activity", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard("Unread", (state.stats?.totalUnread ?: 0).toString(), Modifier.weight(1f))
                    StatCard("Read", (state.stats?.totalRead ?: 0).toString(), Modifier.weight(1f))
                }
                Spacer(modifier = Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard("Feeds", (state.stats?.totalFeeds ?: 0).toString(), Modifier.weight(1f))
                    StatCard("Categories", (state.stats?.totalCategories ?: 0).toString(), Modifier.weight(1f))
                }
            }
        }

        item {
            AuthenticatedDevicesSection(
                sessions = state.authSessions,
                onRevokeSession = actions.onRevokeAuthSession,
            )
        }

        item {
            FeedSurfaceCard {
                Button(
                    onClick = actions.onLogout,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Sign out")
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Logout")
                }
            }
        }
    }
}

private const val AUTO_LOAD_MORE_THRESHOLD = 5

@Composable
fun StatsTab(state: SettingsTabState, actions: SettingsTabActions) {
    SettingsTab(state, actions)
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(modifier = Modifier.height(10.dp))
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
    }
}
