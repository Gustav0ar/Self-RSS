package com.selffeed.android.network

data class LoginRequest(
    val email: String,
    val password: String,
)

data class RegisterRequest(
    val email: String,
    val password: String,
)

data class CreateCategoryRequest(
    val name: String,
    val parentCategoryId: String? = null,
)

data class UpdateCategoryRequest(
    val name: String? = null,
    val parentCategoryId: String? = null,
)

data class CreateFeedRequest(
    val feedUrl: String,
    val categoryId: String,
    val title: String? = null,
)

data class UpdateFeedRequest(
    val categoryId: String? = null,
    val title: String? = null,
    val pollingIntervalMinutes: Int? = null,
)

data class MarkReadRequest(
    val read: Boolean,
    val source: String = "manual",
)

data class MarkAllReadRequest(
    val feedId: String? = null,
    val categoryId: String? = null,
)

data class UpdatePreferencesRequest(
    val theme: String? = null,
    val fontFamily: String? = null,
    val textSize: Int? = null,
    val density: String? = null,
    val defaultSort: String? = null,
    val hideRead: Boolean? = null,
    val keyboardShortcutsEnabled: Boolean? = null,
    val autoMarkReadMode: String? = null,
)

data class UpdateAppSettingsRequest(
    val registrationLocked: Boolean,
)
