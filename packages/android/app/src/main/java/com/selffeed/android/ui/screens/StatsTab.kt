package com.selffeed.android.ui.screens

import androidx.compose.runtime.Composable

/**
 * Stats intentionally reuses the settings surface, but keeps the app-shell
 * destination in its own feature file so future dashboard work has a clear
 * home rather than growing the shared tab file.
 */
@Composable
fun StatsTab(state: SettingsTabState, actions: SettingsTabActions) {
    SettingsTab(state, actions)
}
