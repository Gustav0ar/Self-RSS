package com.selffeed.android.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.core.content.edit
import java.util.UUID

class SessionStore(context: Context) {
    private val appContext = context.applicationContext
    
    private val masterKey = MasterKey.Builder(appContext)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        appContext,
        PREFS_NAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    @Synchronized
    fun getAccessToken(): String? = prefs.getString(KEY_ACCESS_TOKEN, null)

    @Synchronized
    fun setAccessToken(token: String?) {
        prefs.edit { putString(KEY_ACCESS_TOKEN, token) }
    }

    @Synchronized
    fun getRefreshCookie(): String? = prefs.getString(KEY_REFRESH_COOKIE, null)

    @Synchronized
    fun setRefreshCookie(rawCookie: String?) {
        prefs.edit { putString(KEY_REFRESH_COOKIE, rawCookie) }
    }

    @Synchronized
    fun getClientId(): String {
        val existing = prefs.getString(KEY_CLIENT_ID, null)
        if (!existing.isNullOrBlank()) return existing

        val generated = UUID.randomUUID().toString()
        prefs.edit { putString(KEY_CLIENT_ID, generated) }
        return generated
    }

    @Synchronized
    fun clear() {
        val clientId = getClientId()
        prefs.edit {
            clear()
            putString(KEY_CLIENT_ID, clientId)
        }
    }

    companion object {
        private const val PREFS_NAME = "rss_secure_session"
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_COOKIE = "refresh_cookie"
        private const val KEY_CLIENT_ID = "client_id"
    }
}
