package com.selffeed.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.selffeed.android.R
import kotlinx.coroutines.flow.Flow

/** No success label until Room has supplied the durable pending count. */
@Composable
internal fun ArticleSyncStatusLine(
    online: Boolean,
    pendingChanges: Flow<Int>,
    onRetry: () -> Unit,
) {
    val count by pendingChanges.collectAsStateWithLifecycle(initialValue = null)
    Column(Modifier.fillMaxWidth().background(Color.Black)) {
        HorizontalDivider(color = Color(0xFF303030))
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val pending = count?.takeIf { it > 0 }
            if (pending != null || !online || count == 0) {
                Icon(
                    imageVector = when {
                        !online -> Icons.Outlined.CloudOff
                        pending != null -> Icons.Outlined.Refresh
                        else -> Icons.Outlined.Check
                    },
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(16.dp),
                )
                Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                    Text(
                        text = when {
                            pending != null -> pluralStringResource(R.plurals.sync_pending_changes, pending, pending)
                            !online -> stringResource(R.string.cd_offline)
                            else -> stringResource(R.string.sync_up_to_date)
                        },
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White,
                    )
                    if (pending != null && !online) {
                        Text(
                            stringResource(R.string.sync_when_online),
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFFB8B8B8),
                        )
                    }
                }
                if (pending != null && online) {
                    TextButton(onClick = onRetry) {
                        Text(stringResource(R.string.action_retry), color = Color.White)
                    }
                }
            }
        }
    }
}

@Composable
internal fun OfflineTextStatus(
    articleId: String,
    observeAvailability: (String) -> Flow<Boolean>,
) {
    key(articleId, observeAvailability) {
        val availability = remember(articleId, observeAvailability) { observeAvailability(articleId) }
        val available by availability.collectAsStateWithLifecycle(initialValue = null)
        available?.let { downloaded ->
            Row(
                modifier = Modifier.padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (downloaded) {
                    Icon(
                        Icons.Outlined.Download,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    stringResource(if (downloaded) R.string.article_text_available_offline else R.string.article_text_not_downloaded),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
