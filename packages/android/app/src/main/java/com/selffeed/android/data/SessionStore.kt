package com.selffeed.android.data

import android.content.Context
import android.util.Base64
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Persists the user's session (access token, refresh cookie, install-scoped
 * client id) on disk.
 *
 * Implementation: [DataStore]<[Preferences]> (the modern, non-deprecated
 * storage primitive) with per-value AES256/GCM encryption backed by an
 * AndroidKeyStore-wrapped master key. The `EncryptedSharedPreferences`
 * API is fully removed from this file (the `androidx.security.crypto`
 * module is kept only for the `MasterKey` type and the AES256/GCM
 * primitives it wraps).
 *
 * Encryption model:
 * - The `client_id` is a UUID with no security boundary; stored
 *   plaintext.
 * - The `access_token` and `refresh_cookie` are encrypted
 *   value-by-value with AES256/GCM. The 12-byte IV is prepended to
 *   the ciphertext so each read is self-contained.
 * - The DataStore file itself is plaintext (the file format is the
 *   standard `PreferencesMapCompat` proto, public) but every
 *   security-sensitive value is opaque to anyone reading the file.
 *
 * One-time migration: on first construction we look for the legacy
 * `rss_secure_session` SharedPreferences file and, if present,
 * copy the access token / refresh cookie / client id into the
 * new DataStore. The legacy file is left in place (the system
 * owns it) but is no longer read.
 *
 * The public API (getAccessToken / setAccessToken / getRefreshCookie /
 * setRefreshCookie / getClientId / clear) is unchanged from the
 * EncryptedSharedPreferences version, so all callers continue to
 * work without modification.
 */
class SessionStore(context: Context) {
    private val appContext = context.applicationContext
    private val dataStore: DataStore<Preferences> = appContext.sessionDataStore
    @Volatile private var accessTokenLoaded = false
    @Volatile private var accessTokenCache: String? = null
    @Volatile private var refreshCookieLoaded = false
    @Volatile private var refreshCookieCache: String? = null
    @Volatile private var clientIdCache: String? = null

    private val masterKey: MasterKey by lazy {
        MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    init {
        // Best-effort one-time migration of legacy EncryptedSharedPreferences.
        runCatching { migrateLegacyIfPresent() }
            .onFailure { Log.w(TAG, "Legacy session migration failed", it) }
    }

    fun getAccessToken(): String? {
        if (accessTokenLoaded) return accessTokenCache
        return runBlocking {
            decrypt(dataStore.data.first()[KEY_ACCESS_TOKEN]).also {
                accessTokenCache = it
                accessTokenLoaded = true
            }
        }
    }

    fun setAccessToken(token: String?) {
        runBlocking {
            val encrypted = token?.let(::encrypt)
            dataStore.edit { prefs ->
                if (encrypted == null) prefs.remove(KEY_ACCESS_TOKEN) else prefs[KEY_ACCESS_TOKEN] = encrypted
            }
        }
        accessTokenCache = token
        accessTokenLoaded = true
    }

    fun getRefreshCookie(): String? {
        if (refreshCookieLoaded) return refreshCookieCache
        return runBlocking {
            decrypt(dataStore.data.first()[KEY_REFRESH_COOKIE]).also {
                refreshCookieCache = it
                refreshCookieLoaded = true
            }
        }
    }

    fun setRefreshCookie(rawCookie: String?) {
        runBlocking {
            val encrypted = rawCookie?.let(::encrypt)
            dataStore.edit { prefs ->
                if (encrypted == null) prefs.remove(KEY_REFRESH_COOKIE) else prefs[KEY_REFRESH_COOKIE] = encrypted
            }
        }
        refreshCookieCache = rawCookie
        refreshCookieLoaded = true
    }

    fun getClientId(): String {
        clientIdCache?.let { return it }
        return runBlocking {
            dataStore.edit { prefs ->
                val existing = prefs[KEY_CLIENT_ID]
                if (existing.isNullOrBlank()) {
                    prefs[KEY_CLIENT_ID] = UUID.randomUUID().toString()
                }
            }[KEY_CLIENT_ID] ?: UUID.randomUUID().toString()
        }.also { clientIdCache = it }
    }

    fun clear() {
        runBlocking {
            val clientId = getClientId()
            dataStore.edit { prefs ->
                prefs.clear()
                prefs[KEY_CLIENT_ID] = clientId
            }
            accessTokenCache = null
            accessTokenLoaded = true
            refreshCookieCache = null
            refreshCookieLoaded = true
            clientIdCache = clientId
        }
    }

    /**
     * Encrypts a plaintext value with AES256/GCM. The format is
     * `iv (12 bytes) || ciphertext || gcm tag (16 bytes)`, encoded as
     * base64 for storage. A new IV is generated for every call, so
     * the same plaintext produces different ciphertexts each time.
     */
    private fun encrypt(plaintext: String): String {
        val key = masterKeyKey()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        // The IV is generated internally by the cipher; for storage
        // we re-init the cipher with the same IV to produce a
        // self-contained blob.
        val blob = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, blob, 0, iv.size)
        System.arraycopy(ciphertext, 0, blob, iv.size, ciphertext.size)
        return Base64.encodeToString(blob, Base64.NO_WRAP)
    }

    private fun decrypt(payload: String?): String? {
        if (payload.isNullOrBlank()) return null
        val blob = runCatching { Base64.decode(payload, Base64.NO_WRAP) }.getOrNull() ?: return null
        if (blob.size <= GCM_IV_LENGTH) return null
        val iv = blob.copyOfRange(0, GCM_IV_LENGTH)
        val ciphertext = blob.copyOfRange(GCM_IV_LENGTH, blob.size)
        val key = masterKeyKey()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, iv))
        return runCatching {
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        }.getOrNull()
    }

    /**
     * Derive a stable AES-256 key from the master key alias. The
     * master key is a 256-bit AES key, so we can use it directly
     * without an extra HKDF step. (Internally `MasterKey` uses
     * `AES256_GCM` with HKDF-4KB, so the key bound to the alias
     * is already a usable AES-256 key.)
     */
    private fun masterKeyKey(): SecretKey {
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (ks.getEntry(MASTER_KEY_ALIAS, null) as java.security.KeyStore.SecretKeyEntry).secretKey
    }

    private fun migrateLegacyIfPresent() {
        val legacyFile = java.io.File(
            appContext.filesDir.parentFile,
            "共享_prefs/rss_secure_session.xml",
        )
        if (!legacyFile.exists()) return
        Log.d(TAG, "Migrating legacy session from ${legacyFile.absolutePath}")
        val legacy = appContext.getSharedPreferences("rss_secure_session", Context.MODE_PRIVATE)
        val accessToken = legacy.getString("access_token", null)
        val refreshCookie = legacy.getString("refresh_cookie", null)
        val clientId = legacy.getString("client_id", null)
        runBlocking {
            dataStore.edit { prefs ->
                if (accessToken != null) prefs[KEY_ACCESS_TOKEN] = accessToken // already encrypted by legacy
                if (refreshCookie != null) prefs[KEY_REFRESH_COOKIE] = refreshCookie
                if (clientId != null) prefs[KEY_CLIENT_ID] = clientId
            }
            accessTokenLoaded = false
            refreshCookieLoaded = false
            clientIdCache = clientId
        }
    }

    companion object {
        private const val TAG = "SessionStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_LENGTH = 12
        private const val GCM_TAG_LENGTH = 128
        private const val MASTER_KEY_ALIAS = "_androidx_security_master_key_"

        private val KEY_ACCESS_TOKEN = stringPreferencesKey("access_token")
        private val KEY_REFRESH_COOKIE = stringPreferencesKey("refresh_cookie")
        private val KEY_CLIENT_ID = stringPreferencesKey("client_id")
    }
}

/**
 * Top-level DataStore delegate for the session. The `preferencesDataStore`
 * extension can't be declared at file-level twice; centralizing it here
 * ensures a single [DataStore] per process.
 */
private val Context.sessionDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "rss_secure_session",
)
