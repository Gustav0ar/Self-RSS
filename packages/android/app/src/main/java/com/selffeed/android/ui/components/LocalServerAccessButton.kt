package com.selffeed.android.ui.components

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.selffeed.android.R

/** A public server needs no nearby-device access. Let LAN users opt in when choosing a server. */
@Composable
internal fun LocalServerAccessButton(onGranted: () -> Unit) {
    if (Build.VERSION.SDK_INT < 37) return
    val activity = LocalActivity.current ?: return
    val permission = Manifest.permission.ACCESS_LOCAL_NETWORK
    fun hasAccess() = activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    var granted by remember { mutableStateOf(hasAccess()) }
    var needsSettings by rememberSaveable { mutableStateOf(false) }
    val latestOnGranted by rememberUpdatedState(onGranted)
    fun updateAccess(allowed: Boolean) {
        val newlyGranted = allowed && !granted
        granted = allowed
        if (newlyGranted) latestOnGranted()
    }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        needsSettings = !allowed && !activity.shouldShowRequestPermissionRationale(permission)
        updateAccess(allowed)
    }
    LifecycleResumeEffect(activity) {
        updateAccess(hasAccess())
        onPauseOrDispose {}
    }
    if (!granted) {
        TextButton(onClick = {
            if (needsSettings) {
                activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${activity.packageName}".toUri()))
            } else {
                request.launch(permission)
            }
        }) {
            Text(stringResource(if (needsSettings) R.string.local_server_permission_settings else R.string.allow_local_server_access))
        }
    }
}
