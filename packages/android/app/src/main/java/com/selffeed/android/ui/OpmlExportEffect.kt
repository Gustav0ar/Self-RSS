package com.selffeed.android.ui

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.selffeed.android.ui.components.shareOpmlFile
import kotlinx.coroutines.flow.filterNotNull

/** Only the resumed account screen may hand a prepared file to the system chooser. */
@Composable
internal fun OpmlExportEffect(
    viewModel: FeedsViewModel,
    isCurrentSession: () -> Boolean,
    share: (Context, Uri) -> Unit = ::shareOpmlFile,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val currentSession = rememberUpdatedState(isCurrentSession)
    val currentShare = rememberUpdatedState(share)
    LaunchedEffect(viewModel, lifecycle, context) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            viewModel.opmlExports.filterNotNull().collect { export ->
                if (currentSession.value() && viewModel.prepareOpmlHandoff(export) && currentSession.value()) {
                    val shared = try {
                        currentShare.value(context, export.uri)
                        true
                    } catch (_: Exception) {
                        false
                    }
                    viewModel.completeOpmlExport(export, shared)
                }
            }
        }
    }
}
