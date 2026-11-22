package com.selffeed.android.network

import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
)

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
)

@Serializable
data class ChangePasswordRequest(
    val currentPassword: String,
    val newPassword: String,
)

@Serializable
data class CreateCategoryRequest(
    val name: String,
    val parentCategoryId: String? = null,
)

@Serializable
data class UpdateCategoryRequest(
    val name: String? = null,
    val parentCategoryId: String? = null,
)

@Serializable
data class CreateFeedRequest(
    val feedUrl: String,
    val categoryId: String,
    val title: String? = null,
)

@Serializable
data class UpdateFeedRequest(
    val feedUrl: String? = null,
    val categoryId: String? = null,
    val title: String? = null,
    val pollingIntervalMinutes: Int? = null,
)

@Serializable
data class ArticleStateLookupRequest(val articleIds: List<String>)

@Serializable
data class MarkReadRequest(
    val read: Boolean,
    val source: String = "manual",
    val mutationId: String? = null,
    val baseRevision: Int? = null,
)

@Serializable
data class SaveArticleRequest(
    val saved: Boolean,
    val mutationId: String? = null,
    val baseRevision: Int? = null,
)

@Serializable
data class MarkAllReadRequest(
    val feedId: String? = null,
    val categoryId: String? = null,
)

@Serializable
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

@Serializable
data class UpdateAppSettingsRequest(
    val registrationLocked: Boolean,
)
