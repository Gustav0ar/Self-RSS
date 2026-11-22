package com.selffeed.android.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.keyframes
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.selffeed.android.R

@Composable
internal fun ArticleBookmarkIcon(
    articleId: String,
    isSaved: Boolean,
    unsavedColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    var previous by remember(articleId) { mutableStateOf(isSaved) }
    val scale = remember(articleId) { Animatable(1f) }
    LaunchedEffect(articleId, isSaved) {
        if (previous == isSaved) return@LaunchedEffect
        previous = isSaved
        scale.animateTo(
            targetValue = 1f,
            animationSpec = keyframes {
                durationMillis = 165
                0.88f at 40
                1.08f at 105
            },
        )
    }
    Icon(
        imageVector = if (isSaved) Icons.Default.Bookmark else Icons.Outlined.BookmarkBorder,
        contentDescription = stringResource(
            if (isSaved) R.string.article_remove_saved else R.string.article_save,
        ),
        tint = if (isSaved) MaterialTheme.colorScheme.primary else unsavedColor,
        modifier = Modifier.size(24.dp).graphicsLayer {
            scaleX = scale.value
            scaleY = scale.value
        },
    )
}
