package com.selffeed.android.data.local

import androidx.room.testing.MigrationTestHelper
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
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
    fun `version 1 schema validates against exported room schema`() {
        helper.createDatabase(TEST_DB, 1).use { database ->
            database.query("SELECT COUNT(*) FROM categories").use { cursor ->
                cursor.moveToFirst()
            }
        }

        helper.runMigrationsAndValidate(
            TEST_DB,
            1,
            true,
            *LOCAL_DATABASE_MIGRATIONS,
        ).close()
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
    }
}
