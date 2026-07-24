package com.selffeed.android.ui.screens

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.selffeed.android.R
import com.selffeed.android.ui.ArticleSortPreference
import com.selffeed.android.ui.AutoMarkReadPreference
import com.selffeed.android.ui.DensityPreference
import com.selffeed.android.ui.ReaderFontPreference
import com.selffeed.android.ui.ThemePreference
import com.selffeed.android.ui.resolve
import kotlin.math.roundToInt

@Composable
fun SettingsTab(state: SettingsTabState, actions: SettingsTabActions) {
    val prefs = state.preferences
    if (prefs == null) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.preferencesLoading) {
                    CircularProgressIndicator()
                    Text(
                        stringResource(R.string.settings_loading),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                } else {
                    Text(
                        stringResource(R.string.settings_unavailable),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        state.preferencesLoadError?.resolve()
                            ?: stringResource(R.string.settings_unavailable_detail),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(onClick = actions.onRetryPreferences) {
                        Text(stringResource(R.string.action_retry))
                    }
                }
            }
        }
        return
    }
    val selectedTheme = ThemePreference.fromApiValue(prefs.theme)
    val selectedSort = ArticleSortPreference.fromApiValue(prefs.defaultSort)
    val selectedDensity = DensityPreference.fromApiValue(prefs.density)
    val selectedFont = ReaderFontPreference.fromApiValue(prefs.fontFamily)
    val selectedAutoMark = AutoMarkReadPreference.fromApiValue(prefs.autoMarkReadMode)
    val draftTextSize = remember(prefs.textSize) { mutableIntStateOf(prefs.textSize) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            FeedSurfaceCard {
                Text(
                    stringResource(R.string.settings_preferences),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    stringResource(R.string.settings_preferences_detail),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item {
            FeedSurfaceCard {
                Text(
                    stringResource(R.string.settings_reader_font),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(modifier = Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ReaderFontPreference.entries.chunked(2).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            row.forEach { option ->
                                FilterChip(
                                    selected = selectedFont == option,
                                    onClick = { actions.onFontChanged(option) },
                                    label = { Text(stringResource(option.labelRes)) },
                                )
                            }
                        }
                    }
                }
            }
        }
        item {
            FeedSurfaceCard {
                Text(
                    stringResource(R.string.settings_theme),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedTheme == ThemePreference.LIGHT, onClick = { actions.onThemeChanged(ThemePreference.LIGHT) }, label = { Text(stringResource(R.string.settings_theme_light)) }, leadingIcon = { Icon(Icons.Outlined.LightMode, contentDescription = stringResource(R.string.settings_toggle_light_mode)) })
                    FilterChip(selected = selectedTheme == ThemePreference.DARK, onClick = { actions.onThemeChanged(ThemePreference.DARK) }, label = { Text(stringResource(R.string.settings_theme_dark)) }, leadingIcon = { Icon(Icons.Outlined.DarkMode, contentDescription = stringResource(R.string.settings_toggle_dark_mode)) })
                    FilterChip(selected = selectedTheme == ThemePreference.SYSTEM, onClick = { actions.onThemeChanged(ThemePreference.SYSTEM) }, label = { Text(stringResource(R.string.settings_theme_system)) })
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
                        Text(stringResource(R.string.settings_hide_read), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.settings_hide_read_detail), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = prefs.hideRead, onCheckedChange = actions.onHideReadChanged)
                }
            }
        }
        item {
            FeedSurfaceCard {
                Text(stringResource(R.string.settings_sort_order), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedSort == ArticleSortPreference.LATEST, onClick = { actions.onSortChanged(ArticleSortPreference.LATEST) }, label = { Text(stringResource(R.string.settings_sort_newest)) })
                    FilterChip(selected = selectedSort == ArticleSortPreference.OLDEST, onClick = { actions.onSortChanged(ArticleSortPreference.OLDEST) }, label = { Text(stringResource(R.string.settings_sort_oldest)) })
                }
            }
        }
        item {
            FeedSurfaceCard {
                Text(stringResource(R.string.settings_density), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedDensity == DensityPreference.COMFORTABLE, onClick = { actions.onDensityChanged(DensityPreference.COMFORTABLE) }, label = { Text(stringResource(R.string.settings_density_comfortable)) })
                    FilterChip(selected = selectedDensity == DensityPreference.COMPACT, onClick = { actions.onDensityChanged(DensityPreference.COMPACT) }, label = { Text(stringResource(R.string.settings_density_compact)) })
                }
            }
        }
        item {
            FeedSurfaceCard {
                Text(stringResource(R.string.settings_reader_text_size), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Slider(
                    value = draftTextSize.intValue.toFloat(),
                    onValueChange = { draftTextSize.intValue = it.roundToInt() },
                    onValueChangeFinished = { actions.onTextSizeChanged(draftTextSize.intValue) },
                    valueRange = 12f..24f,
                )
                Text(stringResource(R.string.settings_text_size_sp, draftTextSize.intValue), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            FeedSurfaceCard {
                Text(stringResource(R.string.settings_auto_mark_read), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(6.dp))
                Text(stringResource(R.string.settings_auto_mark_read_detail), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(modifier = Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    AutoMarkReadPreference.entries.forEach { option ->
                        FilterChip(
                            selected = selectedAutoMark == option,
                            onClick = { actions.onAutoMarkReadModeChanged(option) },
                            label = {
                                Text(
                                    when (option) {
                                        AutoMarkReadPreference.DISABLED -> R.string.settings_auto_mark_disabled
                                        AutoMarkReadPreference.ON_NAVIGATE -> R.string.settings_auto_mark_navigate
                                        AutoMarkReadPreference.ON_OPEN -> R.string.settings_auto_mark_open
                                    }.let { stringResource(it) },
                                )
                            },
                        )
                    }
                }
            }
        }
        item {
            FeedSurfaceCard {
                Text(stringResource(R.string.settings_activity), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard(stringResource(R.string.stats_unread), (state.stats?.totalUnread ?: 0).toString(), Modifier.weight(1f))
                    StatCard(stringResource(R.string.stats_read), (state.stats?.totalRead ?: 0).toString(), Modifier.weight(1f))
                }
                Spacer(modifier = Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard(stringResource(R.string.stats_feeds), (state.stats?.totalFeeds ?: 0).toString(), Modifier.weight(1f))
                    StatCard(stringResource(R.string.stats_categories), (state.stats?.totalCategories ?: 0).toString(), Modifier.weight(1f))
                }
            }
        }
        item { AuthenticatedDevicesSection(sessions = state.authSessions, onRevokeSession = actions.onRevokeAuthSession) }
        item {
            FeedSurfaceCard {
                Button(onClick = actions.onLogout, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp)) {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = stringResource(R.string.settings_sign_out_cd))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(R.string.settings_logout))
                }
            }
        }
    }
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
