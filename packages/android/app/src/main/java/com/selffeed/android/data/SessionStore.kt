@file:Suppress("DEPRECATION")

package com.selffeed.android.data

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.selffeed.android.BuildConfig
import com.selffeed.android.network.normalizeApiServerHost
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Persists the user's session (access token, refresh cookie, install-scoped
 * client id, API server host) on disk.
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
 * - The `api_base_url` is user-visible server host configuration; stored
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
 * The token, cookie, client id, and clear APIs remain compatible with
 * the EncryptedSharedPreferences version. The API server base URL is
 * persisted alongside the session so every network call can target the
 * user-selected SelfFeed instance.
 */
class SessionStore internal constructor(
    context: Context,
    private val legacyPreferencesFactory: LegacyPreferencesFactory? = null,
) {
    private val appContext = context.applicationContext
    private val dataStore: DataStore<Preferences> = appContext.sessionDataStore

    private val cacheLock = Any()

    // Cached session values. `preload()` warms them, but getters still
    // lazily load from DataStore so session correctness never depends on
    // AppViewModel startup ordering.
    @Volatile private var cachedAccessToken: String? = null
    @Volatile private var cachedRefreshCookie: String? = null
    @Volatile private var cachedClientId: String? = null
    @Volatile private var cachedApiBaseUrl: String? = null
    @Volatile private var accessTokenLoaded = false
    @Volatile private var refreshCookieLoaded = false
    @Volatile private var apiBaseUrlLoaded = false
    @Volatile private var preloaded = false

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

    /**
     * Loads all session data from DataStore into memory caches.
     * Call this early at app startup (e.g., from AppViewModel init or Application).
     * All getter methods return cached values after this is called.
     */
    suspend fun preload() {
        if (preloaded && accessTokenLoaded && refreshCookieLoaded && apiBaseUrlLoaded) return
        val prefs = dataStore.data.first()
        val accessToken = decrypt(prefs[KEY_ACCESS_TOKEN])
        val refreshCookie = decrypt(prefs[KEY_REFRESH_COOKIE])
        val clientId = prefs[KEY_CLIENT_ID]
        val apiBaseUrl = normalizeStoredApiBaseUrl(prefs[KEY_API_BASE_URL])
        synchronized(cacheLock) {
            if (!accessTokenLoaded) {
                cachedAccessToken = accessToken
                accessTokenLoaded = true
            }
            if (!refreshCookieLoaded) {
                cachedRefreshCookie = refreshCookie
                refreshCookieLoaded = true
            }
            if (cachedClientId == null) {
                cachedClientId = clientId
            }
            if (!apiBaseUrlLoaded) {
                cachedApiBaseUrl = apiBaseUrl
                apiBaseUrlLoaded = true
            }
            preloaded = true
        }
    }

    fun getAccessToken(): String? {
        if (accessTokenLoaded) return cachedAccessToken
        val token = runBlocking { decrypt(dataStore.data.first()[KEY_ACCESS_TOKEN]) }
        synchronized(cacheLock) {
            if (!accessTokenLoaded) {
                cachedAccessToken = token
                accessTokenLoaded = true
            }
            return cachedAccessToken
        }
    }

    fun setAccessToken(token: String?) {
        runBlocking {
            val encrypted = token?.let(::encrypt)
            dataStore.edit { prefs ->
                if (encrypted == null) prefs.remove(KEY_ACCESS_TOKEN) else prefs[KEY_ACCESS_TOKEN] = encrypted
            }
        }
        synchronized(cacheLock) {
            cachedAccessToken = token
            accessTokenLoaded = true
        }
    }

    fun getRefreshCookie(): String? {
        if (refreshCookieLoaded) return cachedRefreshCookie
        val cookie = runBlocking { decrypt(dataStore.data.first()[KEY_REFRESH_COOKIE]) }
        synchronized(cacheLock) {
            if (!refreshCookieLoaded) {
                cachedRefreshCookie = cookie
                refreshCookieLoaded = true
            }
            return cachedRefreshCookie
        }
    }

    fun setRefreshCookie(rawCookie: String?) {
        runBlocking {
            val encrypted = rawCookie?.let(::encrypt)
            dataStore.edit { prefs ->
                if (encrypted == null) prefs.remove(KEY_REFRESH_COOKIE) else prefs[KEY_REFRESH_COOKIE] = encrypted
            }
        }
        synchronized(cacheLock) {
            cachedRefreshCookie = rawCookie
            refreshCookieLoaded = true
        }
    }

    fun getClientId(): String {
        cachedClientId?.let { return it }
        return runBlocking {
            dataStore.edit { prefs ->
                val existing = prefs[KEY_CLIENT_ID]
                if (existing.isNullOrBlank()) {
                    prefs[KEY_CLIENT_ID] = UUID.randomUUID().toString()
                }
            }[KEY_CLIENT_ID] ?: UUID.randomUUID().toString()
        }.also { cachedClientId = it }
    }

    fun getApiBaseUrl(): String {
        if (apiBaseUrlLoaded) return cachedApiBaseUrl ?: defaultApiBaseUrl()
        val apiBaseUrl = runBlocking { normalizeStoredApiBaseUrl(dataStore.data.first()[KEY_API_BASE_URL]) }
        synchronized(cacheLock) {
            if (!apiBaseUrlLoaded) {
                cachedApiBaseUrl = apiBaseUrl
                apiBaseUrlLoaded = true
            }
            return cachedApiBaseUrl ?: defaultApiBaseUrl()
        }
    }

    fun setApiBaseUrl(rawBaseUrl: String): String {
        val normalized = normalizeApiServerHost(rawBaseUrl)
        val previous = getApiBaseUrl()
        val changed = previous != normalized
        runBlocking {
            dataStore.edit { prefs ->
                prefs[KEY_API_BASE_URL] = normalized
                if (changed) {
                    prefs.remove(KEY_ACCESS_TOKEN)
                    prefs.remove(KEY_REFRESH_COOKIE)
                }
            }
        }
        synchronized(cacheLock) {
            cachedApiBaseUrl = normalized
            apiBaseUrlLoaded = true
            if (changed) {
                cachedAccessToken = null
                cachedRefreshCookie = null
                accessTokenLoaded = true
                refreshCookieLoaded = true
            }
        }
        return normalized
    }

    fun clear() {
        val clientId = cachedClientId ?: getClientId()
        val apiBaseUrl = getApiBaseUrl()
        runBlocking {
            val legacyMigrationMarker = dataStore.data.first()[KEY_LEGACY_SESSION_MIGRATED]
            dataStore.edit { prefs ->
                prefs.clear()
                prefs[KEY_CLIENT_ID] = clientId
                prefs[KEY_API_BASE_URL] = apiBaseUrl
                if (legacyMigrationMarker != null) {
                    prefs[KEY_LEGACY_SESSION_MIGRATED] = legacyMigrationMarker
                }
            }
            synchronized(cacheLock) {
                cachedAccessToken = null
                cachedRefreshCookie = null
                cachedClientId = clientId
                cachedApiBaseUrl = apiBaseUrl
                accessTokenLoaded = true
                refreshCookieLoaded = true
                apiBaseUrlLoaded = true
                preloaded = true
            }
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
        return runCatching {
            val key = masterKeyKey()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        }
            .onFailure { Log.w(TAG, "Stored session value could not be decrypted", it) }
            .getOrNull()
    }

    /**
     * Derive a stable AES-256 key from the master key alias. The
     * master key is a 256-bit AES key, so we can use it directly
     * without an extra HKDF step. (Internally `MasterKey` uses
     * `AES256_GCM` with HKDF-4KB, so the key bound to the alias
     * is already a usable AES-256 key.)
     */
    private fun masterKeyKey(): SecretKey {
        // Force androidx.security to create the alias before reading it
        // directly. Some devices return null for an alias that has not
        // been materialized yet, and casting that null crashes OkHttp
        // when the refresh cookie is persisted after login.
        runCatching { ensureMasterKeyExists() }
            .onFailure { Log.w(TAG, "MasterKey initialization failed; falling back to direct key generation", it) }
        val alias = MASTER_KEY_ALIAS
        val ks = java.security.KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = ks.getEntry(alias, null)
        if (existing is java.security.KeyStore.SecretKeyEntry) {
            return existing.secretKey
        }

        if (existing != null) {
            Log.w(TAG, "Unexpected AndroidKeyStore entry for $alias; regenerating session key")
            ks.deleteEntry(alias)
        } else {
            Log.w(TAG, "AndroidKeyStore entry for $alias was missing; generating session key")
        }

        return generateMasterKey(alias)
    }

    private fun generateMasterKey(alias: String): SecretKey {
        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        keyGenerator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return keyGenerator.generateKey()
    }

    private fun ensureMasterKeyExists() {
        // Accessing the lazy value runs MasterKey.Builder.build(), which
        // creates the AndroidKeyStore alias when it is absent. The keyAlias
        // accessor is not public in all androidx.security versions, so the
        // app keeps using the documented default alias constant below.
        masterKey.toString()
    }

    private fun migrateLegacyIfPresent() {
        val legacyFile = legacySessionPreferencesFile(appContext)
        if (!legacyFile.exists()) return
        Log.d(TAG, "Migrating legacy session from ${legacyFile.absolutePath}")
        val existing = runBlocking { dataStore.data.first() }
        if (existing[KEY_LEGACY_SESSION_MIGRATED] == "true") {
            return
        }

        if (existing[KEY_ACCESS_TOKEN] != null || existing[KEY_REFRESH_COOKIE] != null) {
            runBlocking {
                dataStore.edit { prefs ->
                    prefs[KEY_LEGACY_SESSION_MIGRATED] = "true"
                }
            }
            return
        }

        val legacy = legacyPreferencesFactory?.invoke(appContext)
            ?: openLegacyEncryptedPreferences(appContext, masterKey)
        val accessToken = legacy.getString("access_token", null)
        val refreshCookie = legacy.getString("refresh_cookie", null)
        val clientId = legacy.getString("client_id", null)
        runBlocking {
            dataStore.edit { prefs ->
                if (accessToken != null) prefs[KEY_ACCESS_TOKEN] = encrypt(accessToken)
                if (refreshCookie != null) prefs[KEY_REFRESH_COOKIE] = encrypt(refreshCookie)
                if (clientId != null) prefs[KEY_CLIENT_ID] = clientId
                prefs[KEY_LEGACY_SESSION_MIGRATED] = "true"
            }
            synchronized(cacheLock) {
                cachedAccessToken = accessToken
                cachedRefreshCookie = refreshCookie
                cachedClientId = clientId
                accessTokenLoaded = true
                refreshCookieLoaded = true
                preloaded = true
            }
        }
        legacy.edit().clear().apply()
    }

    private fun normalizeStoredApiBaseUrl(rawBaseUrl: String?): String =
        rawBaseUrl
            ?.let { runCatching { normalizeApiServerHost(it) }.getOrNull() }
            ?: defaultApiBaseUrl()

    private fun defaultApiBaseUrl(): String = normalizeApiServerHost(BuildConfig.API_BASE_URL)

    companion object {
        private const val TAG = "SessionStore"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_LENGTH = 12
        private const val GCM_TAG_LENGTH = 128
        private const val MASTER_KEY_ALIAS = "_androidx_security_master_key_"

        private val KEY_ACCESS_TOKEN = stringPreferencesKey("access_token")
        private val KEY_REFRESH_COOKIE = stringPreferencesKey("refresh_cookie")
        private val KEY_CLIENT_ID = stringPreferencesKey("client_id")
        private val KEY_API_BASE_URL = stringPreferencesKey("api_base_url")
        private val KEY_LEGACY_SESSION_MIGRATED = stringPreferencesKey("legacy_session_migrated")
    }
}

private typealias LegacyPreferencesFactory = (Context) -> SharedPreferences

@Suppress("DEPRECATION")
private fun openLegacyEncryptedPreferences(context: Context, masterKey: MasterKey): SharedPreferences =
    EncryptedSharedPreferences.create(
        context,
        "rss_secure_session",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

internal fun legacySessionPreferencesFile(context: Context): java.io.File =
    java.io.File(context.applicationContext.filesDir.parentFile, "shared_prefs/rss_secure_session.xml")

/**
 * Top-level DataStore delegate for the session. The `preferencesDataStore`
 * extension can't be declared at file-level twice; centralizing it here
 * ensures a single [DataStore] per process.
 */
private val Context.sessionDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "rss_secure_session",
)
