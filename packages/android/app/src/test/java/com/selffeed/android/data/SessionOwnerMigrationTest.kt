package com.selffeed.android.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class SessionOwnerMigrationTest {
    @get:Rule val temporaryFolder = TemporaryFolder()
    private val versionKey = longPreferencesKey("session_schema_version")
    private val ownerKey = stringPreferencesKey("session_owner_id")

    private fun TestScope.preferences(): DataStore<Preferences> {
        val file = temporaryFolder.newFolder().resolve("session.preferences_pb")
        return PreferenceDataStoreFactory.create(scope = backgroundScope, produceFile = { file })
    }

    @Test
    fun `logout waits for preload and leaves durable and memory owners consistent`() = runTest {
        val preferences = preferences()
        preferences.edit { it[longPreferencesKey("last_authenticated_at")] = 1_700_000_000_000L }
        val reading = CompletableDeferred<Unit>()
        val releaseRead = CompletableDeferred<Unit>()
        val delayed = object : DataStore<Preferences> by preferences {
            override val data = flow {
                reading.complete(Unit)
                releaseRead.await()
                emitAll(preferences.data)
            }
        }
        val store = SessionStore(
            ApplicationProvider.getApplicationContext(), StandardTestDispatcher(testScheduler), dataStore = delayed,
        )
        val load = async { store.preload(); store.currentSession() }
        reading.await()
        val logout = async { store.clear() }
        runCurrent()
        assertFalse(logout.isCompleted)

        releaseRead.complete(Unit)
        val loadedOwner = load.await()
        logout.await()

        assertNotEquals(loadedOwner.ownerId, store.currentSession().ownerId)
        assertFalse(store.isCurrentSession(loadedOwner))
        assertFalse(store.hasValidOfflineAccessLease(1_700_000_001_000L))
        assertEquals(store.currentSession().ownerId, preferences.data.first()[ownerKey])
    }

    @Test
    fun `request captured before preload cannot acquire an adopted session`() = runTest {
        val preferences = preferences()
        val store = SessionStore(
            ApplicationProvider.getApplicationContext(), StandardTestDispatcher(testScheduler), dataStore = preferences,
        )
        val provisional = store.currentSession()
        assertFalse(store.isCurrentSession(provisional))

        store.preload()

        assertFalse(store.isCurrentSession(provisional))
        assertFalse(store.setAccessTokenIfCurrent(provisional, "must-not-be-stored"))
        assertFalse(store.setRefreshCookieIfCurrent(provisional, "must-not-be-stored"))
        assertTrue(store.isCurrentSession(store.currentSession()))
    }

    @Test
    fun `new store creates a durable owner that survives store reconstruction`() = runTest {
        val preferences = preferences()
        val context = ApplicationProvider.getApplicationContext<Context>()
        val writer = SessionStore(context, StandardTestDispatcher(testScheduler), dataStore = preferences)
        writer.preload()
        val owner = writer.currentSession().ownerId
        assertEquals(owner, UUID.fromString(owner).toString())
        assertEquals(1L, preferences.data.first()[versionKey])

        val restored = SessionStore(context, StandardTestDispatcher(testScheduler), dataStore = preferences)
        restored.preload()
        assertEquals(owner, restored.currentSession().ownerId)
    }

    @Test
    fun `version zero adoption preserves every stored value and queued analytics`() = runTest {
        val preferences = preferences()
        val access = stringPreferencesKey("access_token")
        val refresh = stringPreferencesKey("refresh_cookie")
        preferences.edit {
            // Opaque encrypted bytes are preserved even when this JVM cannot decrypt them.
            it[access] = "AQID"
            it[refresh] = "BAUG"
            it[stringPreferencesKey("client_id")] = "existing-install"
            it[stringPreferencesKey("api_base_url")] = "reader.example.com"
            it[stringPreferencesKey("feed_refresh_request_id")] = "pending-refresh"
            it[stringPreferencesKey("product_analytics_events")] = "existing-event:app_opened:2026-09-12"
            it[longPreferencesKey("last_authenticated_at")] = 1_700_000_000_000L
            it[stringPreferencesKey("legacy_session_migrated")] = "true"
        }
        val original = preferences.data.first().asMap()
        val store = SessionStore(
            ApplicationProvider.getApplicationContext(), StandardTestDispatcher(testScheduler), dataStore = preferences,
        )

        store.preload()

        val migrated = preferences.data.first().asMap()
        original.forEach { (key, value) -> assertEquals(value, migrated[key]) }
        assertEquals(original.size + 2, migrated.size)
        assertEquals("existing-install", store.getClientId())
        assertEquals("pending-refresh", store.getFeedRefreshRequestId())
        assertEquals("existing-event", store.pendingProductAnalyticsEvents().single().id)
        assertTrue(store.hasValidOfflineAccessLease(1_700_000_001_000L))
        assertEquals(1L, migrated[versionKey])
    }

    @Test
    fun `owner changes on replacement but not repeated server selection or token refresh`() = runTest {
        val preferences = preferences()
        val store = SessionStore(
            ApplicationProvider.getApplicationContext(), StandardTestDispatcher(testScheduler), dataStore = preferences,
        )
        store.preload()
        val initial = store.currentSession()
        store.setApiBaseUrl(store.getApiBaseUrl())
        assertEquals(initial, store.currentSession())
        // Null setters exercise the same guarded persistence path without requiring AndroidKeyStore.
        assertTrue(store.setAccessTokenIfCurrent(initial, null))
        assertTrue(store.setRefreshCookieIfCurrent(initial, null))
        assertEquals(initial, store.currentSession())

        val login = store.beginAuthentication()
        assertNotEquals(initial.ownerId, login.ownerId)
        assertFalse(store.isCurrentSession(initial))
        store.setApiBaseUrl("replacement.example.com")
        val replacement = store.currentSession()
        assertNotEquals(login.ownerId, replacement.ownerId)
        store.clear()
        assertNotEquals(replacement.ownerId, store.currentSession().ownerId)
        assertEquals(store.currentSession().ownerId, preferences.data.first()[ownerKey])
        assertEquals(1L, preferences.data.first()[versionKey])
    }

    @Test
    fun `unsupported future schema remains unchanged`() = runTest {
        val preferences = preferences()
        preferences.edit {
            it[versionKey] = 2
            it[ownerKey] = "future-owner"
            it[stringPreferencesKey("access_token")] = "opaque-future-token"
        }
        val original = preferences.data.first()
        val store = SessionStore(
            ApplicationProvider.getApplicationContext(), StandardTestDispatcher(testScheduler), dataStore = preferences,
        )

        assertTrue(runCatching { store.preload() }.exceptionOrNull() is IllegalStateException)
        assertTrue(runCatching { store.clear() }.exceptionOrNull() is IllegalStateException)
        assertEquals(original, preferences.data.first())
    }
}
