package com.selffeed.android.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import androidx.core.content.edit

class SessionStore(context: Context) {
    private val appContext = context.applicationContext
    private val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
    
    private val prefs = EncryptedSharedPreferences.create(
        PREFS_NAME,
        masterKeyAlias,
        appContext,
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
    fun clear() {
        prefs.edit { clear() }
    }

    companion object {
        private const val PREFS_NAME = "rss_secure_session"
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_COOKIE = "refresh_cookie"
    }
}
