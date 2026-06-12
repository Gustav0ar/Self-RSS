package com.selffeed.android.network

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class LoginRequest(
    val email: String,
    val password: String,
)

@JsonClass(generateAdapter = true)
data class RegisterRequest(
    val email: String,
    val password: String,
)

@JsonClass(generateAdapter = true)
data class CreateCategoryRequest(
    val name: String,
    val parentCategoryId: String? = null,
)

@JsonClass(generateAdapter = true)
data class UpdateCategoryRequest(
    val name: String? = null,
    val parentCategoryId: String? = null,
)

@JsonClass(generateAdapter = true)
data class CreateFeedRequest(
    val feedUrl: String,
    val categoryId: String,
    val title: String? = null,
)

@JsonClass(generateAdapter = true)
data class UpdateFeedRequest(
    val categoryId: String? = null,
    val title: String? = null,
    val pollingIntervalMinutes: Int? = null,
)

@JsonClass(generateAdapter = true)
data class MarkReadRequest(
    val read: Boolean,
    val source: String = "manual",
)

@JsonClass(generateAdapter = true)
data class MarkAllReadRequest(
    val feedId: String? = null,
    val categoryId: String? = null,
)

@JsonClass(generateAdapter = true)
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

@JsonClass(generateAdapter = true)
data class UpdateAppSettingsRequest(
    val registrationLocked: Boolean,
)
