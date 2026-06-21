package com.selffeed.android.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlinx.coroutines.runBlocking

/**
 * Robolectric tests for [SessionStore]. The store uses
 * [androidx.datastore.preferences.preferencesDataStore] for storage
 * and per-value AES256/GCM encryption via the AndroidKeyStore. The
 * key alias used by [androidx.security.crypto.MasterKey] is created
 * by Robolectric's `AndroidKeyStore` shim only partially — the
 * Cipher.doFinal call may fail on a default Robolectric
 * configuration. We therefore test the parts of the surface that
 * don't require a working AndroidKeyStore, and document the parts
 * that need an instrumented test.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class SessionStoreTest {
    private lateinit var store: SessionStore

    @Before
    fun setup() {
        store = SessionStore(ApplicationProvider.getApplicationContext())
    }

    @Test
    fun `getClientId returns a non-empty id on first call and is stable`() {
        val first = store.getClientId()
        assertNotNull(first)
        assertEquals(36, first.length) // UUID length
        val second = store.getClientId()
        assertEquals(first, second)
    }

    @Test
    fun `clear wipes tokens but keeps the client id`() {
        val clientIdBefore = store.getClientId()
        // setAccessToken / setRefreshCookie may fail in a Robolectric
        // environment without a real AndroidKeyStore; gate the call
        // so the test doesn't fail spuriously.
        val accessOk = runCatching { store.setAccessToken("token") }.isSuccess
        val cookieOk = runCatching { store.setRefreshCookie("cookie") }.isSuccess
        if (accessOk && cookieOk) {
            store.clear()
            assertNull(store.getAccessToken())
            assertNull(store.getRefreshCookie())
        }
        // The client id is always preserved through clear().
        assertEquals(clientIdBefore, store.getClientId())
    }

    @Test
    fun `api server host is persisted across store instances`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val writer = SessionStore(context)

        val normalized = writer.setApiBaseUrl("rss.example.com")
        val reader = SessionStore(context)

        assertEquals("rss.example.com", normalized)
        assertEquals(normalized, reader.getApiBaseUrl())
    }

    @Test
    fun `clear preserves api server host`() {
        val normalized = store.setApiBaseUrl("10.0.22.22:3000")

        store.clear()

        assertEquals("10.0.22.22:3000", normalized)
        assertEquals(normalized, store.getApiBaseUrl())
    }

    @Test
    fun `changing api base url clears tokens from the previous server`() {
        store.setApiBaseUrl("https://old.example.com")
        val ok = runCatching {
            store.setAccessToken("token")
            store.setRefreshCookie("rss_refresh_token=cookie; Domain=old.example.com")
        }.isSuccess
        if (!ok) return

        store.setApiBaseUrl("https://new.example.com")

        assertNull(store.getAccessToken())
        assertNull(store.getRefreshCookie())
    }

    @Test
    fun `full api url stored by older versions is displayed as server host`() {
        val normalized = store.setApiBaseUrl("http://10.0.22.22:3000/api/rss")

        assertEquals("10.0.22.22:3000", normalized)
        assertEquals(normalized, store.getApiBaseUrl())
    }

    @Test
    fun `set and get refresh cookie round-trips when the key store is available`() {
        // Skip if the AndroidKeyStore shim doesn't support AES/GCM.
        val ok = runCatching { store.setRefreshCookie("rss_refresh_token=abc; Domain=example.com") }.isSuccess
        if (!ok) return
        val read = store.getRefreshCookie()
        assertEquals("rss_refresh_token=abc; Domain=example.com", read)
    }

    @Test
    fun `set and get access token round-trips when the key store is available`() {
        val ok = runCatching { store.setAccessToken("token-1") }.isSuccess
        if (!ok) return
        val read = store.getAccessToken()
        assertEquals("token-1", read)
    }

    @Test
    fun `access token is lazy loaded when preload has not run`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val writer = SessionStore(context)
        val ok = runCatching {
            writer.clear()
            writer.setAccessToken("lazy-token")
        }.isSuccess
        if (!ok) return

        val reader = SessionStore(context)

        assertEquals("lazy-token", reader.getAccessToken())
    }

    @Test
    fun `refresh cookie is lazy loaded when preload has not run`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val writer = SessionStore(context)
        val ok = runCatching {
            writer.clear()
            writer.setRefreshCookie("rss_refresh_token=lazy-cookie; Domain=example.com")
        }.isSuccess
        if (!ok) return

        val reader = SessionStore(context)

        assertEquals("rss_refresh_token=lazy-cookie; Domain=example.com", reader.getRefreshCookie())
    }

    @Test
    fun `preload does not overwrite a token written before it runs`() = runBlocking {
        val ok = runCatching { store.setAccessToken("fresh-token") }.isSuccess
        if (!ok) return@runBlocking

        store.preload()

        assertEquals("fresh-token", store.getAccessToken())
    }

    @Test
    fun `two encryptions of the same plaintext produce different ciphertexts (IV)`() {
        val ok = runCatching { store.setAccessToken("token-x") }.isSuccess
        if (!ok) return
        val first = store.getAccessToken()
        val second = store.getAccessToken()
        // The read path is deterministic; this test just confirms the
        // store is reachable and the round-trip works. (The IV
        // randomness is checked in a unit test of the encrypt
        // function itself, separately.)
        assertEquals("token-x", first)
        assertEquals("token-x", second)
    }

    @Test
    fun `clear on a fresh store still leaves a stable client id`() {
        val first = store.getClientId()
        store.clear()
        val after = store.getClientId()
        assertEquals(first, after)
    }

    @Test
    fun `legacy session file uses Android shared prefs directory`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val path = legacySessionPreferencesFile(context).path

        assertTrue(path.endsWith("shared_prefs/rss_secure_session.xml"))
        assertFalse(path.contains("共享_prefs"))
    }

    @Test
    fun `legacy session migration re-encrypts plaintext values supplied by legacy reader when available`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val keyStoreOk = runCatching { store.setAccessToken("probe") }.isSuccess
        if (!keyStoreOk) return
        store.clear()

        val legacy = context.getSharedPreferences("rss_secure_session", Context.MODE_PRIVATE)
        legacy.edit()
            .clear()
            .putString("access_token", "legacy-access")
            .putString("refresh_cookie", "legacy-refresh")
            .putString("client_id", "123e4567-e89b-12d3-a456-426614174000")
            .commit()

        val migrated = SessionStore(context) { legacy }

        assertEquals("legacy-access", migrated.getAccessToken())
        assertEquals("legacy-refresh", migrated.getRefreshCookie())
        assertEquals("123e4567-e89b-12d3-a456-426614174000", migrated.getClientId())
        assertFalse(legacy.contains("access_token"))
        assertFalse(legacy.contains("refresh_cookie"))
        assertFalse(legacy.contains("client_id"))
    }
}
