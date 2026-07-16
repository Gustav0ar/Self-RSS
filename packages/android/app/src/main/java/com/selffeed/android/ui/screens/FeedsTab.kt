package com.selffeed.android.ui.screens

import android.content.Context
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.platform.testTag
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

private sealed interface FeedManagementDialog {
    data class CategoryEditor(val category: CategoryWithCounts?) : FeedManagementDialog
    data class FeedEditor(val feed: FeedWithCounts?) : FeedManagementDialog
    data class DeleteCategory(val category: CategoryWithCounts) : FeedManagementDialog
    data class DeleteFeed(val feed: FeedWithCounts) : FeedManagementDialog
}

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
    val failedFeedWarnings = remember(state.feeds) {
        state.feeds.filter { feedHealthIssue(it) != null }
    }
    val healthFingerprint = remember(failedFeedWarnings) {
        failedFeedWarnings.feedHealthFingerprint()
    }
    var dismissedHealthFingerprint by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(healthFingerprint) {
        if (healthFingerprint.isEmpty()) dismissedHealthFingerprint = null
    }
    // Categories can be populated into the same snapshot-backed list after this
    // screen is composed. Do not cache the flattened result by list identity or
    // the add-feed dialog can keep an empty category menu while the sidebar is
    // already showing the newly loaded categories.
    val allCategories = state.categories.flattenCategories()
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
        modifier = Modifier
            .fillMaxSize()
            .testTag("feeds-list"),
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
                        enabled = !state.loading,
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
                        text = "Your first feed will be placed in an Uncategorized category.",
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

        if (
            failedFeedWarnings.isNotEmpty() &&
            dismissedHealthFingerprint != healthFingerprint
        ) {
            item {
                FeedSurfaceCard {
                    Row(verticalAlignment = Alignment.Top) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            modifier = Modifier.padding(top = 2.dp),
                            tint = WarningAmber,
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = if (failedFeedWarnings.size == 1) {
                                    "1 feed is not updating"
                                } else {
                                    "${failedFeedWarnings.size} feeds are not updating"
                                },
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = WarningAmber,
                            )
                            Text(
                                text = "Open a feed's menu and choose Edit for details.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(
                            onClick = { dismissedHealthFingerprint = healthFingerprint },
                            modifier = Modifier
                                .size(32.dp)
                                .testTag("dismiss-feed-health-summary"),
                        ) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "Dismiss feed health summary",
                                modifier = Modifier.size(18.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
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
            onCreateCategory = { name -> actions.onCreateCategory(name, null) },
            onSave = { url, title, categoryId, pollingIntervalMinutes ->
                val feed = dialog.feed
                if (feed == null) {
                    actions.onCreateFeed(url, categoryId, title)
                } else {
                    actions.onUpdateFeed(feed.id, url, title, categoryId, pollingIntervalMinutes)
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
    onCreateCategory: (String) -> Unit,
    onSave: (url: String, title: String?, categoryId: String, pollingIntervalMinutes: Int?) -> Unit,
) {
    var url by remember(feed?.id) { mutableStateOf(feed?.feedUrl.orEmpty()) }
    var title by remember(feed?.id) { mutableStateOf(feed?.title.orEmpty()) }
    var categoryId by remember(feed?.id) { mutableStateOf(feed?.categoryId ?: categories.firstOrNull()?.id.orEmpty()) }
    var pollingInterval by remember(feed?.id) { mutableStateOf(feed?.pollingIntervalMinutes?.toString().orEmpty()) }
    var showCreateCategory by remember(feed?.id) { mutableStateOf(false) }
    val firstCategoryId = categories.firstOrNull()?.id
    LaunchedEffect(feed?.id, firstCategoryId) {
        if (feed == null && categoryId.isBlank()) {
            categoryId = firstCategoryId.orEmpty()
        }
    }
    val validInterval = pollingInterval.toIntOrNull()?.takeIf { it in 5..1440 }
    val canSave = url.trim().isNotEmpty() &&
        (feed == null || (categoryId.isNotBlank() && validInterval != null))
    val healthIssue = feed?.let(::feedHealthIssue)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (feed == null) "Add feed" else "Edit feed") },
        text = {
            Column(
                modifier = Modifier
                    .heightIn(max = 560.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                healthIssue?.let { issue ->
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("feed-health-details"),
                        shape = RoundedCornerShape(14.dp),
                        color = WarningAmber.copy(alpha = 0.1f),
                        border = BorderStroke(1.dp, WarningAmber.copy(alpha = 0.3f)),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.Warning,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                    tint = WarningAmber,
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "Latest refresh failed",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = WarningAmber,
                                )
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = issue.detail,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            issue.failedAt?.let { failedAt ->
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "Last attempt: $failedAt",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = "Review the URL and refresh interval, then save any correction.",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("Feed or website URL") },
                    supportingText = { Text("Paste a feed URL or a site such as example.com") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("feed-url-field"),
                )
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
                    onCreateCategory = { showCreateCategory = true },
                    modifier = Modifier.testTag("feed-category-picker"),
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

    if (showCreateCategory) {
        var categoryName by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showCreateCategory = false },
            title = { Text("Create category") },
            text = {
                OutlinedTextField(
                    value = categoryName,
                    onValueChange = { categoryName = it },
                    label = { Text("Category name") },
                    singleLine = true,
                )
            },
            dismissButton = { TextButton(onClick = { showCreateCategory = false }) { Text("Cancel") } },
            confirmButton = {
                TextButton(
                    enabled = categoryName.trim().isNotEmpty(),
                    onClick = {
                        onCreateCategory(categoryName.trim())
                        showCreateCategory = false
                    },
                ) { Text("Create") }
            },
        )
    }
}

@Composable
private fun CategoryPicker(
    label: String,
    categoryId: String?,
    categories: List<CategoryWithCounts>,
    includeRoot: Boolean = false,
    onCategorySelected: (String?) -> Unit,
    onCreateCategory: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = categories.firstOrNull { it.id == categoryId }?.name
        ?: if (includeRoot) "No parent (top level)" else "Choose a category"
    Box {
        OutlinedButton(onClick = { expanded = true }, modifier = modifier.fillMaxWidth()) {
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
            onCreateCategory?.let { createCategory ->
                DropdownMenuItem(
                    text = { Text("Create new category") },
                    leadingIcon = { Icon(Icons.Default.Add, contentDescription = null) },
                    onClick = {
                        expanded = false
                        createCategory()
                    },
                )
                HorizontalDivider()
            }
            categories.forEach { category ->
                DropdownMenuItem(
                    text = { Text(category.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    modifier = Modifier.testTag("feed-category-option-${category.id}"),
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

internal fun List<CategoryWithCounts>.flattenCategories(): List<CategoryWithCounts> = buildList {
    fun visit(category: CategoryWithCounts) {
        add(category)
        category.children.orEmpty().forEach(::visit)
    }
    this@flattenCategories.forEach(::visit)
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
private fun FeedOverflowMenu(
    onEdit: (() -> Unit)?,
    onDelete: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(modifier = modifier, onClick = { expanded = true }) {
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
    val healthIssue = feedHealthIssue(feed)
    val subtitle = feed.description ?: feed.feedUrl
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
                if (healthIssue != null) {
                    Spacer(modifier = Modifier.width(4.dp))
                    Icon(
                        Icons.Default.Warning,
                        contentDescription = "Feed needs attention. Open Edit for details.",
                        modifier = Modifier.size(14.dp),
                        tint = WarningAmber,
                    )
                }
            }
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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
            FeedOverflowMenu(
                onEdit = onEdit,
                onDelete = onDelete,
                modifier = Modifier.testTag("feed-overflow-${feed.id}"),
            )
        }
    }
}

internal data class FeedHealthIssue(
    val detail: String,
    val failedAt: String?,
    val warning: String,
)

internal fun feedHealthIssue(feed: FeedWithCounts): FeedHealthIssue? {
    if (feed.syncStatus != "error" && feed.lastSyncError.isNullOrBlank()) return null
    val detail = feed.lastSyncError?.trim()?.takeIf { it.isNotEmpty() } ?: "Latest refresh failed"
    val message = if (detail.lastOrNull() in setOf('.', '!', '?')) detail else "$detail."
    val failedAt = feed.lastSyncErrorAt
        ?.let(::formatPublishedAt)
        ?.takeIf { it.isNotBlank() }
    return FeedHealthIssue(
        detail = message,
        failedAt = failedAt,
        warning = "${feed.title} is not updating. $message${failedAt?.let { " Last attempt $it." }.orEmpty()}",
    )
}

internal fun feedSyncWarning(feed: FeedWithCounts): String? = feedHealthIssue(feed)?.warning

private fun List<FeedWithCounts>.feedHealthFingerprint(): String =
    sortedBy { it.id }.joinToString("|") { feed ->
        listOf(feed.id, feed.syncStatus, feed.lastSyncError.orEmpty(), feed.lastSyncErrorAt.orEmpty())
            .joinToString(":")
    }
