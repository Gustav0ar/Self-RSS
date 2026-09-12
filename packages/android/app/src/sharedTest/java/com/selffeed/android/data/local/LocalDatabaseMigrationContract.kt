package com.selffeed.android.data.local

import androidx.room.testing.MigrationTestHelper
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.NetworkModule
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Rule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

abstract class LocalDatabaseMigrationContract {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        LocalDatabase::class.java,
    )

    @Test
    fun version1MigratesThroughTheCompleteProductionChain() {
        helper.createDatabase(TEST_DB, 1).use { database ->
            database.query("SELECT COUNT(*) FROM categories").use { cursor ->
                cursor.moveToFirst()
            }
        }

        helper.runMigrationsAndValidate(
            TEST_DB,
            LOCAL_DATABASE_VERSION,
            true,
            *LOCAL_DATABASE_MIGRATIONS,
        ).close()
    }

    @Test
    fun version3MigrationRemovesTheObsoleteCursorPageTable() {
        helper.createDatabase(TEST_DB_V3, 3).use { database ->
            database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'article_pages'").use { cursor ->
                assertTrue(cursor.moveToFirst())
            }
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V3,
            4,
            true,
            *LOCAL_DATABASE_MIGRATIONS,
        ).use { database ->
            database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'article_pages'").use { cursor ->
                assertTrue(!cursor.moveToFirst())
            }
        }
    }

    @Test
    fun version4MigrationCreatesTheNonPagingReadOverlayTable() {
        helper.createDatabase(TEST_DB_V4, 4).close()

        helper.runMigrationsAndValidate(
            TEST_DB_V4,
            5,
            true,
            *LOCAL_DATABASE_MIGRATIONS,
        ).use { database ->
            database.query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'article_read_overrides'",
            ).use { cursor -> assertTrue(cursor.moveToFirst()) }
        }
    }

    @Test
    fun version6QueuedReadIntentSurvivesTheRevisionAwareMigration() {
        helper.createDatabase(TEST_DB_V6, 6).use { database ->
            database.execSQL(
                "INSERT INTO pending_read_state_mutations(articleId, read, updatedAt) VALUES (?, ?, ?)",
                arrayOf<Any>("article-pending", 1, 1234L),
            )
        }

        helper.runMigrationsAndValidate(
            TEST_DB_V6,
            7,
            true,
            *LOCAL_DATABASE_MIGRATIONS,
        ).use { database ->
            database.query(
                "SELECT articleId, read, mutationId, source, baseRevision, previousState FROM pending_read_state_mutations",
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("article-pending", cursor.getString(0))
                assertEquals(1, cursor.getInt(1))
                assertEquals("", cursor.getString(2))
                assertEquals("manual", cursor.getString(3))
                assertTrue(cursor.isNull(4))
                assertTrue(cursor.isNull(5))
            }
            for (table in listOf("pending_saved_state_mutations", "article_state_revisions", "preferences")) {
                database.query(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
                    arrayOf(table),
                ).use { cursor -> assertTrue("Expected $table after migration", cursor.moveToFirst()) }
            }
        }
    }

    @Test
    fun legacyVersion6SavedStateSurvivesMigration() {
        helper.createDatabase(TEST_DB_LEGACY_V6, 6).use { database ->
            replaceArticlesWithLegacyVersionSixSchema(database)
            database.execSQL(
                """
                INSERT INTO articles(
                    id, feedId, feedTitle, feedFaviconUrl, title, author, excerpt,
                    heroImageUrl, publishedAt, displayedAt, isRead, contentStatus, contentVersion
                ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, 0, 'feed_ready', 1)
                """.trimIndent(),
                arrayOf<Any>("article-saved", "feed-1", "Feed", "Saved article"),
            )
            database.execSQL(
                "INSERT INTO saved_articles(articleId, savedAt) VALUES (?, ?)",
                arrayOf<Any>("article-saved", 1234L),
            )
            database.execSQL(
                "UPDATE room_master_table SET identity_hash = ? WHERE id = 42",
                arrayOf<Any>(LEGACY_VERSION_SIX_IDENTITY_HASH),
            )
        }

        helper.runMigrationsAndValidate(
            TEST_DB_LEGACY_V6,
            7,
            true,
            *LOCAL_DATABASE_MIGRATIONS,
        ).use { database ->
            database.query("SELECT isSaved FROM articles WHERE id = 'article-saved'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(1, cursor.getInt(0))
            }
            database.query(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'saved_articles'",
            ).use { cursor -> assertTrue(!cursor.moveToFirst()) }
        }
    }

    @Test
    fun legacyOfflinePinsSurviveEvenWithoutAMatchingArticleOrReadableBody() {
        val name = "legacy-offline-retention-test"
        helper.createDatabase(name, 6).use { database ->
            replaceArticlesWithLegacyVersionSixSchema(database)
            database.execSQL(
                "UPDATE room_master_table SET identity_hash = ? WHERE id = 42",
                arrayOf<Any>(LEGACY_VERSION_SIX_IDENTITY_HASH),
            )
            for ((index, id) in listOf("body-only", "missing", "malformed").withIndex()) {
                database.execSQL(
                    "INSERT INTO saved_articles(articleId, savedAt) VALUES (?, ?)",
                    arrayOf<Any>(id, 1000L + index),
                )
            }
            database.execSQL(
                "INSERT INTO article_details(id, feedId, payloadJson, writtenAt) VALUES (?, NULL, ?, ?)",
                arrayOf<Any>("body-only", "{\"contentText\":\"Offline body without a list row\"}", 20L),
            )
            database.execSQL(
                "INSERT INTO article_details(id, feedId, payloadJson, writtenAt) VALUES (?, NULL, ?, ?)",
                arrayOf<Any>("malformed", "{partially recoverable legacy JSON", 30L),
            )
        }
        helper.runMigrationsAndValidate(name, LOCAL_DATABASE_VERSION, true, *LOCAL_DATABASE_MIGRATIONS).use { database ->
            database.query("SELECT articleId, savedAt FROM legacy_offline_articles ORDER BY savedAt").use { cursor ->
                for ((index, id) in listOf("body-only", "missing", "malformed").withIndex()) {
                    assertTrue(cursor.moveToNext())
                    assertEquals(id, cursor.getString(0))
                    assertEquals(1000L + index, cursor.getLong(1))
                }
                assertTrue(!cursor.moveToNext())
            }
            database.query("SELECT payloadJson, writtenAt FROM article_details WHERE id = 'malformed'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("{partially recoverable legacy JSON", cursor.getString(0))
                assertEquals(30L, cursor.getLong(1))
            }
        }
    }

    @Test
    fun historicalOfflineDocumentRemainsReadableAfterUpgradeAndNormalCacheCleanup() = runBlocking {
        val name = "historical-offline-reopen"
        val moshi = NetworkModule.provideMoshi()
        val detail = ArticleDetail(
            id = "legacy-offline", feedId = "feed", guid = "legacy", canonicalUrl = null,
            title = "Offline", excerpt = null, contentHtml = "<p>Previously saved offline</p>",
            contentText = "Previously saved offline", heroImageUrl = null, publishedAt = null,
            fetchedAt = "2026-01-01T00:00:00Z", hash = "legacy", feedTitle = "Local", isRead = false,
        )
        val legacyJson = JSONObject(moshi.adapter(ArticleDetail::class.java).toJson(detail)).apply {
            remove("isSaved")
        }.toString()
        helper.createDatabase(name, 6).use { database ->
            replaceArticlesWithLegacyVersionSixSchema(database)
            database.execSQL("UPDATE room_master_table SET identity_hash = ? WHERE id = 42", arrayOf<Any>(LEGACY_VERSION_SIX_IDENTITY_HASH))
            database.execSQL("""
                INSERT INTO articles(id, feedId, feedTitle, title, isRead, contentStatus, contentVersion)
                VALUES ('legacy-offline', 'feed', 'Local', 'Offline', 0, 'feed_ready', 1)
            """.trimIndent())
            database.execSQL("INSERT INTO saved_articles(articleId, savedAt) VALUES ('legacy-offline', 17)")
            database.execSQL("INSERT INTO article_details(id, feedId, payloadJson, writtenAt) VALUES (?, ?, ?, ?)",
                arrayOf<Any>(detail.id, detail.feedId, legacyJson, 3L))
        }
        val database = Room.databaseBuilder(ApplicationProvider.getApplicationContext(), LocalDatabase::class.java, name)
            .addMigrations(*LOCAL_DATABASE_MIGRATIONS).build()
        try {
            val store = LocalStore(database, moshi)
            val dao = database.localStoreDao()
            assertEquals(legacyJson, dao.readArticleDetail(detail.id)?.payloadJson)
            assertEquals(3L, dao.readArticleDetail(detail.id)?.writtenAt)
            assertEquals(detail.contentText, store.readArticleDetail(detail.id)?.contentText)
            assertEquals(false, store.readArticleDetail(detail.id)?.isSaved)
            store.switchOwner(LocalOwnerEntity(ownerId = "migrated-session", apiBaseUrl = "https://example.invalid/api/v1/"))
            store.writeArticleDetail(detail.copy(id = "other"))
            store.clearArticleDetails()
            assertEquals(legacyJson, dao.readArticleDetail(detail.id)?.payloadJson)
            assertTrue(store.clearSavedStateIfUnchanged(SavedArticleSnapshot(detail.id, null)))
            assertEquals(detail.contentText, store.readArticleDetail(detail.id)?.contentText)
            assertTrue(dao.isLegacyOfflineArticle(detail.id))
        } finally { database.close() }
        helper.runMigrationsAndValidate(name, LOCAL_DATABASE_VERSION, true, *LOCAL_DATABASE_MIGRATIONS).close()
    }

    @Test
    fun version8DoesNotPromoteUnversionedFlagsIntoConfirmedRevisionPairs() = runBlocking {
        val name = "state-provenance-v8"
        helper.createDatabase(name, 8).use { database ->
            database.execSQL("INSERT INTO current_local_owner VALUES ('current', 'owner-8', 'https://example.invalid/api/v1/', 'user-8')")
            for (id in listOf("row", "pending", "unversioned")) {
                database.execSQL("""
                    INSERT INTO articles(id, feedId, feedTitle, title, isRead, isSaved, contentStatus, contentVersion)
                    VALUES (?, 'feed', 'Feed', 'Cached', 0, 0, 'feed_ready', 1)
                """.trimIndent(), arrayOf(id))
                database.execSQL("INSERT INTO article_state_revisions VALUES (?, ?, ?)",
                    arrayOf<Any?>(id, if (id == "unversioned") null else 10, if (id == "unversioned") null else 10))
                database.execSQL("INSERT INTO article_details VALUES (?, 'feed', ?, 42)",
                    arrayOf(id, "{opaque cached bytes for $id"))
            }
            database.execSQL("""
                INSERT INTO pending_read_state_mutations VALUES ('pending', 1, 'read-m', 'manual', 10, 0, 17)
            """.trimIndent())
            database.execSQL("INSERT INTO pending_saved_state_mutations VALUES ('pending', 1, 'saved-m', 10, 0, 18)")
        }
        helper.runMigrationsAndValidate(name, LOCAL_DATABASE_VERSION, true, *LOCAL_DATABASE_MIGRATIONS).close()
        val database = Room.databaseBuilder(ApplicationProvider.getApplicationContext(), LocalDatabase::class.java, name)
            .addMigrations(*LOCAL_DATABASE_MIGRATIONS).build()
        try {
            val dao = database.localStoreDao()
            val store = LocalStore(database, NetworkModule.provideMoshi())
            assertEquals("owner-8", store.readOwner()?.ownerId)
            for (id in listOf("row", "pending")) {
                val state = requireNotNull(dao.readArticleStateRevision(id))
                assertEquals(10, state.readRevision)
                assertEquals(10, state.savedRevision)
                assertEquals(null, state.confirmedReadState)
                assertEquals(null, state.confirmedSavedState)
                assertEquals("{opaque cached bytes for $id", dao.readArticleDetail(id)?.payloadJson)
                assertEquals(42L, dao.readArticleDetail(id)?.writtenAt)
                store.updateArticleReadState(id, true, 10)
                store.updateArticleSavedState(id, true, 10)
                assertEquals(true, dao.readArticleStateRevision(id)?.confirmedReadState)
                assertEquals(true, dao.readArticleStateRevision(id)?.confirmedSavedState)
            }
            assertEquals("read-m", store.readPendingReadStateMutations().single().mutationId)
            assertEquals("saved-m", store.readPendingSavedStateMutations().single().mutationId)
            assertEquals(false, dao.readArticleStateRevision("unversioned")?.confirmedReadState)
            assertEquals(false, dao.readArticleStateRevision("unversioned")?.confirmedSavedState)
        } finally { database.close() }
    }

    @Test
    fun version9PreservesQueuedIntentAndRecoversOnlyKnownMutationIdentityAndMembership() = runBlocking {
        val name = "mutation-identity-v9"
        helper.createDatabase(name, 9).use { database ->
            database.execSQL("""
                INSERT INTO articles(id, feedId, feedTitle, title, isRead, isSaved, contentStatus, contentVersion)
                VALUES ('article', 'feed', 'Feed', 'Cached', 1, 1, 'feed_ready', 1)
            """.trimIndent())
            database.execSQL("INSERT INTO article_state_revisions VALUES ('article', 10, 20, 0, 0)")
            database.execSQL("INSERT INTO pending_read_state_mutations VALUES ('article', 1, 'read-9', 'manual', 10, 0, 17)")
            database.execSQL("INSERT INTO pending_saved_state_mutations VALUES ('article', 1, 'saved-9', 20, 0, 18)")
            database.execSQL("INSERT INTO article_details VALUES ('article', 'feed', '{unchanged bytes', 42)")
        }
        helper.runMigrationsAndValidate(name, LOCAL_DATABASE_VERSION, true, *LOCAL_DATABASE_MIGRATIONS).close()
        val database = Room.databaseBuilder(ApplicationProvider.getApplicationContext(), LocalDatabase::class.java, name)
            .addMigrations(*LOCAL_DATABASE_MIGRATIONS).build()
        try {
            val store = LocalStore(database, NetworkModule.provideMoshi())
            val dao = database.localStoreDao()
            val state = requireNotNull(dao.readArticleStateRevision("article"))
            assertEquals("read-9", state.lastReadMutationId)
            assertEquals("saved-9", state.lastSavedMutationId)
            assertEquals("feed", state.articleFeedId)
            assertEquals(false, state.confirmedReadState)
            assertEquals(false, state.confirmedSavedState)
            assertEquals(10, state.readRevision)
            assertEquals(20, state.savedRevision)
            assertEquals(null, store.readPendingReadStateMutations().single().countScopeJson)
            assertEquals("{unchanged bytes", dao.readArticleDetail("article")?.payloadJson)
            assertEquals(null, store.readStats())
        } finally { database.close() }
    }

    @Test
    fun everySupportedUpgradePreservesExistingRowsAndCachedBytes() {
        for (version in 1 until LOCAL_DATABASE_VERSION) {
            val name = "populated-migration-$version"
            val before = helper.createDatabase(name, version).use { database ->
                seedExistingTables(database)
            }
            helper.runMigrationsAndValidate(name, LOCAL_DATABASE_VERSION, true, *LOCAL_DATABASE_MIGRATIONS).use { database ->
                before.forEach { (table, expected) ->
                    val columns = expected.first().keys.toList()
                    assertEquals("Rows changed in $table migrating $version", expected, database.rows(table, columns))
                }
                database.query("SELECT COUNT(*) FROM current_local_owner").use { cursor ->
                    assertTrue(cursor.moveToFirst())
                    assertEquals("Migration must preserve existing owners", before["current_local_owner"]?.size ?: 0, cursor.getInt(0))
                }
            }
        }
    }

    @Test
    fun productionRegistrySelectsTheDirectLegacyPreservationPath() {
        val registry = RoomDatabase.MigrationContainer().apply { addMigrations(*LOCAL_DATABASE_MIGRATIONS) }
        assertEquals(listOf(MIGRATION_6_8), registry.findMigrationPath(6, 8))
        assertEquals(listOf(MIGRATION_7_8), registry.findMigrationPath(7, 8))
        for (version in 1 until LOCAL_DATABASE_VERSION) {
            val path = requireNotNull(registry.findMigrationPath(version, LOCAL_DATABASE_VERSION))
            assertEquals(version, path.first().startVersion)
            assertEquals(LOCAL_DATABASE_VERSION, path.last().endVersion)
        }
    }

    @Test
    fun cleanProductionDatabaseMatchesTheExportedSchemaAndReopens() {
        val name = "clean-owner-schema"
        val created = Room.databaseBuilder(ApplicationProvider.getApplicationContext(), LocalDatabase::class.java, name)
            .addMigrations(*LOCAL_DATABASE_MIGRATIONS).build()
        try {
            created.openHelper.writableDatabase.execSQL(
                "INSERT INTO current_local_owner(`key`, ownerId, apiBaseUrl) VALUES ('current', 'clean-owner', 'https://example.invalid/api/v1/')",
            )
        } finally { created.close() }
        helper.runMigrationsAndValidate(name, LOCAL_DATABASE_VERSION, true, *LOCAL_DATABASE_MIGRATIONS).use { database ->
            database.query("SELECT ownerId FROM current_local_owner").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("clean-owner", cursor.getString(0))
            }
        }
    }

    private companion object {
        const val LEGACY_VERSION_SIX_IDENTITY_HASH = "50dc3cac87d1fb0f5d521e32af728af2"
        const val TEST_DB = "local-database-migration-test"
        const val TEST_DB_V3 = "local-database-migration-v3-test"
        const val TEST_DB_V4 = "local-database-migration-v4-test"
        const val TEST_DB_V6 = "local-database-migration-v6-test"
        const val TEST_DB_LEGACY_V6 = "local-database-migration-legacy-v6-test"
    }
}

/** Populate every persisted column, including nullable values and opaque cached JSON. */
private fun seedExistingTables(database: SupportSQLiteDatabase): Map<String, List<Map<String, String?>>> {
    val tables = database.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
            "AND name NOT IN ('room_master_table', 'android_metadata', 'article_pages') ORDER BY name",
    ).use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.getString(0)) } }
    return tables.associateWith { table ->
        val columns = database.query("PRAGMA table_info(`$table`)").use { cursor ->
            buildList {
                while (cursor.moveToNext()) add(Triple(cursor.getString(1), cursor.getString(2), cursor.getInt(3) == 0))
            }
        }
        repeat(2) { row ->
            val values = columns.map { (name, type, nullable) ->
                when {
                    nullable && row == 1 -> null
                    name in setOf("read", "saved", "isRead", "isSaved", "previousState", "endReached") -> row.toLong()
                    type == "INTEGER" -> (row + 1L) * 123L
                    name == "payloadJson" -> "{\"opaque\":\"cached bytes $row ☕\"}"
                    name == "mutationId" -> "mutation-$row"
                    else -> "$name-fixture-$row"
                }
            }.toTypedArray<Any?>()
            database.execSQL(
                "INSERT INTO `$table` (${columns.joinToString { "`${it.first}`" }}) VALUES (${columns.joinToString { "?" }})",
                values,
            )
        }
        database.rows(table, columns.map { it.first })
    }
}

private fun SupportSQLiteDatabase.rows(table: String, columns: List<String>): List<Map<String, String?>> {
    val names = columns.joinToString { "`$it`" }
    return query("SELECT $names FROM `$table` ORDER BY $names").use { cursor ->
        buildList {
            while (cursor.moveToNext()) add(columns.mapIndexed { index, name ->
                name to if (cursor.isNull(index)) null else cursor.getString(index)
            }.toMap())
        }
    }
}

internal fun replaceArticlesWithLegacyVersionSixSchema(database: SupportSQLiteDatabase) {
    database.execSQL("DROP TABLE articles")
    database.execSQL(
        """
        CREATE TABLE articles (
            id TEXT NOT NULL,
            feedId TEXT NOT NULL,
            feedTitle TEXT NOT NULL,
            feedFaviconUrl TEXT,
            title TEXT NOT NULL,
            author TEXT,
            excerpt TEXT,
            heroImageUrl TEXT,
            publishedAt TEXT,
            displayedAt TEXT,
            isRead INTEGER NOT NULL,
            contentStatus TEXT NOT NULL,
            contentVersion INTEGER NOT NULL,
            PRIMARY KEY(id)
        )
        """.trimIndent(),
    )
    database.execSQL("CREATE INDEX index_articles_feedId ON articles(feedId)")
    database.execSQL("CREATE INDEX index_articles_displayedAt ON articles(displayedAt)")
    database.execSQL("CREATE INDEX index_articles_publishedAt ON articles(publishedAt)")
    database.execSQL(
        """
        CREATE TABLE saved_articles (
            articleId TEXT NOT NULL,
            savedAt INTEGER NOT NULL,
            PRIMARY KEY(articleId)
        )
        """.trimIndent(),
    )
}
