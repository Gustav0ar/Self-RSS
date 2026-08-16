package com.selffeed.android.data.local

import androidx.room.testing.MigrationTestHelper
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class LocalDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        LocalDatabase::class.java,
    )

    @Test
    fun `version 1 migrates through the complete production chain`() {
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
    fun `version 3 migration removes the obsolete cursor page table`() {
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
    fun `version 4 migration creates the non paging read overlay table`() {
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
    fun `version 6 queued read intent survives the revision aware migration`() {
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
    fun `migration registry is updated when database version increases`() {
        assertTrue(
            "Add and register MIGRATION_1_2 before increasing LOCAL_DATABASE_VERSION.",
            LOCAL_DATABASE_VERSION == 1 || LOCAL_DATABASE_MIGRATIONS.isNotEmpty(),
        )
    }

    private companion object {
        const val TEST_DB = "local-database-migration-test"
        const val TEST_DB_V3 = "local-database-migration-v3-test"
        const val TEST_DB_V4 = "local-database-migration-v4-test"
        const val TEST_DB_V6 = "local-database-migration-v6-test"
    }
}
