package com.selffeed.android.ui.screens

import android.text.format.Formatter
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.TextObfuscationMode
import androidx.compose.foundation.text.input.clearText
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedSecureTextField
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.LocalAutofillManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.work.WorkInfo
import androidx.work.WorkManager
import coil3.SingletonImageLoader
import com.selffeed.android.ui.components.LocalServerAccessButton
import com.selffeed.android.R
import com.selffeed.android.data.OfflineContentSyncWorker
import com.selffeed.android.data.local.OfflineMediaCacheStats
import com.selffeed.android.ui.ArticleSortPreference
import com.selffeed.android.ui.AutoMarkReadPreference
import com.selffeed.android.ui.DensityPreference
import com.selffeed.android.ui.ReaderFontPreference
import com.selffeed.android.ui.ThemePreference
import com.selffeed.android.ui.components.LocalOfflineMediaCache
import com.selffeed.android.ui.resolve
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
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
                    LocalServerAccessButton(onGranted = actions.onRetryPreferences)
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
    val textSizeSliderState = remember(prefs.textSize) {
        SliderState(
            value = prefs.textSize.toFloat().coerceIn(12f, 24f),
            trackRange = 12f..24f,
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag("settings-list"),
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
                    FilterChip(
                        selected = selectedTheme == ThemePreference.LIGHT,
                        onClick = { actions.onThemeChanged(ThemePreference.LIGHT) },
                        label = { Text(stringResource(R.string.settings_theme_light)) },
                        leadingIcon = {
                            Icon(
                                Icons.Outlined.LightMode,
                                contentDescription = stringResource(R.string.settings_toggle_light_mode)
                            )
                        })
                    FilterChip(
                        selected = selectedTheme == ThemePreference.DARK,
                        onClick = { actions.onThemeChanged(ThemePreference.DARK) },
                        label = { Text(stringResource(R.string.settings_theme_dark)) },
                        leadingIcon = {
                            Icon(
                                Icons.Outlined.DarkMode,
                                contentDescription = stringResource(R.string.settings_toggle_dark_mode)
                            )
                        })
                    FilterChip(
                        selected = selectedTheme == ThemePreference.SYSTEM,
                        onClick = { actions.onThemeChanged(ThemePreference.SYSTEM) },
                        label = { Text(stringResource(R.string.settings_theme_system)) })
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
                        Text(
                            stringResource(R.string.settings_hide_read),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            stringResource(R.string.settings_hide_read_detail),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(checked = prefs.hideRead, onCheckedChange = actions.onHideReadChanged)
                }
            }
        }
        item {
            FeedSurfaceCard {
                Text(
                    stringResource(R.string.settings_sort_order),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = selectedSort == ArticleSortPreference.LATEST,
                        onClick = { actions.onSortChanged(ArticleSortPreference.LATEST) },
                        label = { Text(stringResource(R.string.settings_sort_newest)) })
                    FilterChip(
                        selected = selectedSort == ArticleSortPreference.OLDEST,
                        onClick = { actions.onSortChanged(ArticleSortPreference.OLDEST) },
                        label = { Text(stringResource(R.string.settings_sort_oldest)) })
                }
            }
        }
        item {
            FeedSurfaceCard {
                Text(
                    stringResource(R.string.settings_density),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = selectedDensity == DensityPreference.COMFORTABLE,
                        onClick = { actions.onDensityChanged(DensityPreference.COMFORTABLE) },
                        label = { Text(stringResource(R.string.settings_density_comfortable)) })
                    FilterChip(
                        selected = selectedDensity == DensityPreference.COMPACT,
                        onClick = { actions.onDensityChanged(DensityPreference.COMPACT) },
                        label = { Text(stringResource(R.string.settings_density_compact)) })
                }
            }
        }
        item {
            FeedSurfaceCard {
                Text(
                    stringResource(R.string.settings_reader_text_size),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(10.dp))
                Slider(
                    state = textSizeSliderState,
                    onValueChange = { textSizeSliderState.value = it },
                    onValueChangeFinished = {
                        actions.onTextSizeChanged(textSizeSliderState.value.roundToInt())
                    },
                )
                Text(
                    stringResource(
                        R.string.settings_text_size_sp,
                        textSizeSliderState.value.roundToInt(),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        item {
            FeedSurfaceCard {
                Text(
                    stringResource(R.string.settings_auto_mark_read),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    stringResource(R.string.settings_auto_mark_read_detail),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
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
                Text(
                    stringResource(R.string.settings_activity),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard(
                        stringResource(R.string.stats_unread),
                        (state.stats?.totalUnread ?: 0).toString(),
                        Modifier.weight(1f)
                    )
                    StatCard(
                        stringResource(R.string.stats_read),
                        (state.stats?.totalRead ?: 0).toString(),
                        Modifier.weight(1f)
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard(
                        stringResource(R.string.stats_feeds),
                        (state.stats?.totalFeeds ?: 0).toString(),
                        Modifier.weight(1f)
                    )
                    StatCard(
                        stringResource(R.string.stats_categories),
                        (state.stats?.totalCategories ?: 0).toString(),
                        Modifier.weight(1f)
                    )
                }
            }
        }
        item {
            LocalServerAccessButton(onGranted = actions.onRetryPreferences)
            OfflineStorageSection(isOnline = state.isOnline)
        }
        if (!state.stats?.recentSyncRuns.isNullOrEmpty()) {
            item {
                FeedSurfaceCard {
                    Text(
                        stringResource(R.string.stats_recent_syncs),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    state.stats.recentSyncRuns.forEach { syncRun ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp),
                        ) {
                            Text(
                                syncRun.feedTitle ?: stringResource(R.string.stats_unknown_feed),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                stringResource(
                                    R.string.stats_sync_outcome,
                                    syncRun.status,
                                    syncRun.httpStatus?.toString() ?: "—",
                                    syncRun.itemCount,
                                ),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            syncRun.errorMessage?.let { error ->
                                Text(
                                    error,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                            if (syncRun.status == "failed") {
                                Button(onClick = { actions.onRetryFeedSync(syncRun.feedId) }) {
                                    Text(stringResource(R.string.stats_retry_sync))
                                }
                            }
                        }
                    }
                }
            }
        }
        item {
            PasswordSection(state = state, onChangePassword = actions.onChangePassword)
        }
        item {
            AuthenticatedDevicesSection(
                sessions = state.authSessions,
                onRevokeSession = actions.onRevokeAuthSession
            )
        }
        state.adminRegistrationLocked?.let { registrationLocked ->
            item {
                FeedSurfaceCard {
                    AdminSection(state, actions, registrationLocked)
                }
            }
        }
        item {
            FeedSurfaceCard {
                Button(
                    onClick = actions.onLogout,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp)
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Logout,
                        contentDescription = stringResource(R.string.settings_sign_out_cd)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(R.string.settings_logout))
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OfflineStorageSection(isOnline: Boolean) {
    val context = LocalContext.current
    val mediaCache = LocalOfflineMediaCache.current ?: return
    val scope = rememberCoroutineScope()
    var stats by remember(mediaCache) { mutableStateOf<OfflineMediaCacheStats?>(null) }
    var feedbackRes by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var offlineWorkQueued by remember { mutableStateOf(false) }
    var syncingOffline by remember { mutableStateOf(false) }

    LaunchedEffect(mediaCache) {
        stats = mediaCache.stats()
    }

    LaunchedEffect(context, mediaCache) {
        val workManager = runCatching { WorkManager.getInstance(context) }.getOrNull() ?: return@LaunchedEffect
        workManager.getWorkInfosForUniqueWorkFlow(OfflineContentSyncWorker.WORK_NAME).collect { infos ->
            val wasPending = offlineWorkQueued
            offlineWorkQueued = infos.any { !it.state.isFinished }
            syncingOffline = infos.any { it.state == WorkInfo.State.RUNNING }
            if (wasPending && !offlineWorkQueued) {
                stats = mediaCache.stats()
                if (feedbackRes == R.string.settings_offline_download_started) feedbackRes = null
            }
        }
    }

    FeedSurfaceCard {
        Text(
            text = stringResource(R.string.settings_offline_storage),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = stringResource(R.string.settings_offline_storage_detail),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(8.dp))
        val currentStats = stats
        val summaryText = when {
            currentStats == null || currentStats.fileCount == 0 ->
                stringResource(R.string.settings_offline_cache_empty)
            else -> stringResource(
                R.string.settings_offline_cache_summary,
                Formatter.formatShortFileSize(context, currentStats.totalBytes),
                currentStats.fileCount,
            )
        }
        Text(
            text = summaryText,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
        feedbackRes?.let { res ->
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(res),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
        }
        Spacer(modifier = Modifier.height(10.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            OfflineContentSyncWorker.kickOnce(context)
                            feedbackRes = R.string.settings_offline_download_started
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (_: Exception) {
                            feedbackRes = R.string.settings_offline_download_failed
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = isOnline && !busy && !offlineWorkQueued,
            ) {
                Text(
                    text = stringResource(
                        when {
                            syncingOffline -> R.string.settings_offline_downloading
                            offlineWorkQueued -> R.string.settings_offline_download_started
                            else -> R.string.settings_offline_download_now
                        },
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            OutlinedButton(
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            mediaCache.clearAll()
                            withContext(Dispatchers.IO) {
                                val loader = SingletonImageLoader.get(context)
                                loader.memoryCache?.clear()
                                loader.diskCache?.clear()
                            }
                            stats = mediaCache.stats()
                            feedbackRes = if (stats?.fileCount == 0) R.string.settings_offline_cache_cleared
                                else R.string.settings_offline_clear_failed
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (_: Exception) {
                            feedbackRes = R.string.settings_offline_clear_failed
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && !syncingOffline && (currentStats?.fileCount ?: 0) > 0,
            ) {
                Text(
                    text = stringResource(R.string.settings_offline_clear_cache),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun PasswordSection(
    state: SettingsTabState,
    onChangePassword: (String, String) -> Unit,
) {
    val autofillManager = LocalAutofillManager.current
    val currentPassword = remember { TextFieldState() }
    val newPassword = remember { TextFieldState() }
    val confirmation = remember { TextFieldState() }
    val passwordsMatch = newPassword.text.contentEquals(confirmation.text)
    val canSubmit = state.isOnline &&
        !state.passwordChangePending &&
        currentPassword.text.isNotEmpty() &&
        newPassword.text.length >= 8 &&
        passwordsMatch
    val submitPasswordChange = {
        autofillManager?.commit()
        onChangePassword(currentPassword.text.toString(), newPassword.text.toString())
    }

    LaunchedEffect(state.passwordChangeGeneration) {
        if (state.passwordChangeGeneration > 0) {
            currentPassword.clearAndResetHistory()
            newPassword.clearAndResetHistory()
            confirmation.clearAndResetHistory()
        }
    }

    FeedSurfaceCard {
        Text(
            stringResource(R.string.settings_change_password),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            stringResource(R.string.settings_change_password_detail),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedSecureTextField(
            state = currentPassword,
            label = { Text(stringResource(R.string.settings_current_password)) },
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentType = ContentType.Password },
            textObfuscationMode = TextObfuscationMode.Hidden,
            keyboardOptions = passwordKeyboardOptions(ImeAction.Next),
        )
        OutlinedSecureTextField(
            state = newPassword,
            label = { Text(stringResource(R.string.settings_new_password)) },
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentType = ContentType.NewPassword },
            textObfuscationMode = TextObfuscationMode.Hidden,
            keyboardOptions = passwordKeyboardOptions(ImeAction.Next),
        )
        OutlinedSecureTextField(
            state = confirmation,
            label = { Text(stringResource(R.string.settings_confirm_password)) },
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentType = ContentType.NewPassword },
            textObfuscationMode = TextObfuscationMode.Hidden,
            keyboardOptions = passwordKeyboardOptions(ImeAction.Done),
            onKeyboardAction = {
                if (canSubmit) submitPasswordChange()
            },
            supportingText = if (confirmation.text.isNotEmpty() && !passwordsMatch) {
                { Text(stringResource(R.string.settings_passwords_do_not_match)) }
            } else {
                null
            },
            isError = confirmation.text.isNotEmpty() && !passwordsMatch,
        )
        Button(
            onClick = submitPasswordChange,
            enabled = canSubmit,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                stringResource(
                    if (state.passwordChangePending) {
                        R.string.settings_updating_password
                    } else {
                        R.string.settings_update_password
                    },
                ),
            )
        }
        if (!state.isOnline) {
            Text(
                stringResource(R.string.settings_password_requires_connection),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun AdminSection(
    state: SettingsTabState,
    actions: SettingsTabActions,
    registrationLocked: Boolean,
) {
    val email = remember { TextFieldState() }
    val password = remember { TextFieldState() }
    var createAsAdmin by remember { mutableStateOf(false) }
    var resetUserId by remember { mutableStateOf<String?>(null) }
    var pendingUserUpdate by remember {
        mutableStateOf<Triple<String, String?, Boolean?>?>(null)
    }

    Text(
        stringResource(R.string.settings_administration),
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
    )
    Text(
        stringResource(R.string.settings_administration_detail),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(modifier = Modifier.height(12.dp))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.settings_registration_lock))
        Switch(
            checked = registrationLocked,
            onCheckedChange = actions.onRegistrationLockChanged,
        )
    }
    Spacer(modifier = Modifier.height(16.dp))
    Text(stringResource(R.string.settings_admin_create_user), fontWeight = FontWeight.SemiBold)
    OutlinedTextField(
        state = email,
        label = { Text(stringResource(R.string.auth_email)) },
        modifier = Modifier.fillMaxWidth(),
        lineLimits = TextFieldLineLimits.SingleLine,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Email,
            imeAction = ImeAction.Next,
        ),
    )
    OutlinedSecureTextField(
        state = password,
        label = { Text(stringResource(R.string.auth_password)) },
        modifier = Modifier.fillMaxWidth(),
        textObfuscationMode = TextObfuscationMode.Hidden,
        keyboardOptions = passwordKeyboardOptions(ImeAction.Done),
    )
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.settings_admin_role))
        Switch(checked = createAsAdmin, onCheckedChange = { createAsAdmin = it })
    }
    Button(
        onClick = {
            actions.onCreateAdminUser(
                email.text.toString(),
                password.text.toString(),
                if (createAsAdmin) "admin" else "user",
            )
            email.clearText()
            password.clearAndResetHistory()
            createAsAdmin = false
        },
        enabled = email.text.isNotBlank() && password.text.length >= 8,
    ) {
        Text(stringResource(R.string.settings_admin_create))
    }
    state.adminUsers.forEach { user ->
        Spacer(modifier = Modifier.height(12.dp))
        Text(user.email, fontWeight = FontWeight.SemiBold)
        Text(
            stringResource(
                R.string.settings_admin_user_summary,
                user.role,
                if (user.isActive) {
                    stringResource(R.string.settings_admin_active)
                } else {
                    stringResource(R.string.settings_admin_inactive)
                },
            ),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(
                onClick = {
                    pendingUserUpdate = Triple(
                        user.id,
                        if (user.role == "admin") "user" else "admin",
                        null,
                    )
                },
            ) {
                Text(
                    stringResource(
                        if (user.role == "admin") {
                            R.string.settings_admin_make_reader
                        } else {
                            R.string.settings_admin_make_admin
                        },
                    ),
                )
            }
            OutlinedButton(
                onClick = {
                    pendingUserUpdate = Triple(user.id, null, !user.isActive)
                },
            ) {
                Text(
                    stringResource(
                        if (user.isActive) {
                            R.string.settings_admin_deactivate
                        } else {
                            R.string.settings_admin_activate
                        },
                    ),
                )
            }
        }
        TextButton(onClick = { resetUserId = user.id }) {
            Text(stringResource(R.string.settings_admin_reset_password))
        }
    }

    resetUserId?.let { userId ->
        val resetPassword = remember(userId) { TextFieldState() }
        val closeResetDialog = {
            resetPassword.clearAndResetHistory()
            resetUserId = null
        }
        AlertDialog(
            onDismissRequest = closeResetDialog,
            title = { Text(stringResource(R.string.settings_admin_reset_password)) },
            text = {
                OutlinedSecureTextField(
                    state = resetPassword,
                    label = { Text(stringResource(R.string.auth_password)) },
                    textObfuscationMode = TextObfuscationMode.Hidden,
                    keyboardOptions = passwordKeyboardOptions(ImeAction.Done),
                )
            },
            dismissButton = {
                TextButton(onClick = closeResetDialog) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        actions.onResetAdminPassword(userId, resetPassword.text.toString())
                        closeResetDialog()
                    },
                    enabled = resetPassword.text.length >= 8,
                ) {
                    Text(stringResource(R.string.settings_admin_reset_password))
                }
            },
        )
    }
    pendingUserUpdate?.let { update ->
        AlertDialog(
            onDismissRequest = { pendingUserUpdate = null },
            title = { Text(stringResource(R.string.settings_admin_confirm_change)) },
            text = { Text(stringResource(R.string.settings_admin_confirm_change_detail)) },
            dismissButton = {
                TextButton(onClick = { pendingUserUpdate = null }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        actions.onUpdateAdminUser(update.first, update.second, update.third)
                        pendingUserUpdate = null
                    },
                ) {
                    Text(stringResource(R.string.action_confirm))
                }
            },
        )
    }
}

private fun passwordKeyboardOptions(imeAction: ImeAction) = KeyboardOptions(
    autoCorrectEnabled = false,
    keyboardType = KeyboardType.Password,
    imeAction = imeAction,
)

private fun TextFieldState.clearAndResetHistory() {
    clearText()
    undoState.clearHistory()
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(
                alpha = 0.45f
            )
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(10.dp))
            Text(
                value,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
