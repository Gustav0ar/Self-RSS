package com.selffeed.android.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Exercises real AndroidKeyStore encryption and reopens the persisted DataStore file. */
@RunWith(AndroidJUnit4::class)
class SessionOwnerMigrationDeviceTest {
    @Suppress("DEPRECATION")
    @Test
    fun encryptedSharedPreferencesMigrateIntoAnOwnedSession() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(context.packageName == "com.selffeed.android.devicetest")
        check(!legacySessionPreferencesFile(context).exists()) { "Legacy fixture would overwrite an existing store" }
        val directory = File(context.cacheDir, "encrypted-session-migration-${UUID.randomUUID()}").apply { mkdirs() }
        val file = File(directory, "session.preferences_pb")
        val job = SupervisorJob()
        try {
            val key = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            val legacy = EncryptedSharedPreferences.create(
                context, "rss_secure_session", key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            assertTrue(legacy.edit()
                .putString("access_token", "encrypted-legacy-fixture-access")
                .putString("refresh_cookie", "encrypted-legacy-fixture-refresh")
                .putString("client_id", "existing-legacy-install")
                .commit())
            val preferences = PreferenceDataStoreFactory.create(
                scope = CoroutineScope(job + Dispatchers.IO), produceFile = { file },
            )
            val migrated = SessionStore(context, dataStore = preferences)

            migrated.preload()

            assertEquals("encrypted-legacy-fixture-access", migrated.getAccessToken())
            assertEquals("encrypted-legacy-fixture-refresh", migrated.getRefreshCookie())
            assertEquals("existing-legacy-install", migrated.getClientId())
            assertEquals(1L, preferences.data.first()[longPreferencesKey("session_schema_version")])
            assertEquals(migrated.currentSession().ownerId, preferences.data.first()[stringPreferencesKey("session_owner_id")])
            assertEquals(null, legacy.getString("access_token", null))
            assertEquals(null, legacy.getString("refresh_cookie", null))
        } finally {
            job.cancelAndJoin()
            directory.deleteRecursively()
            // Flush the migration's asynchronous legacy cleanup before removing this fixture.
            context.getSharedPreferences("rss_secure_session", Context.MODE_PRIVATE).edit().clear().commit()
            context.deleteSharedPreferences("rss_secure_session")
        }
    }

    @Test
    fun legacyCredentialsSurviveOwnershipMigrationAndTokenRotation() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(context.packageName == "com.selffeed.android.devicetest")
        val directory = File(context.cacheDir, "session-migration-${UUID.randomUUID()}").apply { mkdirs() }
        val file = File(directory, "session.preferences_pb")
        var job = SupervisorJob()
        fun preferences() = PreferenceDataStoreFactory.create(
            scope = CoroutineScope(job + Dispatchers.IO), produceFile = { file },
        )
        try {
            val legacyPreferences = preferences()
            val writer = SessionStore(context, dataStore = legacyPreferences)
            writer.setApiBaseUrl("offline.example.invalid")
            writer.setAccessToken("migration-fixture-access")
            writer.setRefreshCookie("rss_refresh_token=migration-fixture-refresh; Domain=offline.example.invalid")
            writer.setFeedRefreshRequestId("pending-fixture-refresh")
            writer.recordAuthenticated()
            val event = writer.enqueueProductAnalyticsEvent("app_opened")
            // Produce the exact previous DataStore layout with valid encrypted credentials.
            legacyPreferences.edit {
                it.remove(longPreferencesKey("session_schema_version"))
                it.remove(stringPreferencesKey("session_owner_id"))
            }
            val legacyValues = legacyPreferences.data.first().asMap()
            job.cancelAndJoin()
            job = SupervisorJob()
            val upgradedPreferences = preferences()
            val upgraded = SessionStore(context, dataStore = upgradedPreferences)
            upgraded.preload()
            legacyValues.forEach { (key, value) -> assertEquals(value, upgradedPreferences.data.first().asMap()[key]) }
            assertEquals("migration-fixture-access", upgraded.getAccessToken())
            assertTrue(upgraded.getRefreshCookie()!!.contains("migration-fixture-refresh"))
            assertEquals("pending-fixture-refresh", upgraded.getFeedRefreshRequestId())
            assertEquals(event.id, upgraded.pendingProductAnalyticsEvents().single().id)
            assertTrue(upgraded.hasValidOfflineAccessLease())
            val session = upgraded.currentSession()
            assertTrue(upgraded.setAccessTokenIfCurrent(session, "rotated-fixture-access"))
            assertEquals(session, upgraded.currentSession())
            job.cancelAndJoin()
            job = SupervisorJob()
            val reopened = SessionStore(context, dataStore = preferences())
            reopened.preload()
            assertEquals(session.ownerId, reopened.currentSession().ownerId)
            assertEquals("rotated-fixture-access", reopened.getAccessToken())
        } finally {
            job.cancelAndJoin()
            directory.deleteRecursively()
        }
    }
}
