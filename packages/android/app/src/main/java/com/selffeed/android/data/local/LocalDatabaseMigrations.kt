package com.selffeed.android.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

const val LOCAL_DATABASE_VERSION = 7

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE feeds ADD COLUMN lastSyncError TEXT")
        db.execSQL("ALTER TABLE feeds ADD COLUMN lastSyncErrorAt TEXT")
    }
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE articles ADD COLUMN contentStatus TEXT NOT NULL DEFAULT 'feed_ready'")
        db.execSQL("ALTER TABLE articles ADD COLUMN contentVersion INTEGER NOT NULL DEFAULT 1")
    }
}

/** Removes the obsolete cursor-page cache after Paging 3 became the only list path. */
val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("DROP TABLE IF EXISTS article_pages")
    }
}

/** Keeps read receipts durable without invalidating the visible article PagingSource. */
val MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS article_read_overrides (
                articleId TEXT NOT NULL,
                read INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                PRIMARY KEY(articleId)
            )
            """.trimIndent(),
        )
    }
}

/** Persists saved state with article rows so the smart collection remains available offline. */
val MIGRATION_5_6 = object : Migration(5, 6) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE articles ADD COLUMN isSaved INTEGER NOT NULL DEFAULT 0")
    }
}

/**
 * Adds revision-aware durable outboxes and the remaining offline read models.
 *
 * An early version-6 build stored saved article ids in `saved_articles`. A later
 * version-6 build moved that state to `articles.isSaved`, so devices that ran the
 * early build have a different Room identity hash despite sharing the same
 * database version. Repair that historical schema while migrating to version 7
 * so upgrades preserve both cached articles and saved state.
 */
val MIGRATION_6_7 = object : Migration(6, 7) {
    override fun migrate(db: SupportSQLiteDatabase) {
        val hasLegacySavedArticles = db.hasTable("saved_articles")
        if (!db.hasColumn("articles", "isSaved")) {
            db.execSQL("ALTER TABLE articles ADD COLUMN isSaved INTEGER NOT NULL DEFAULT 0")
        }
        if (hasLegacySavedArticles) {
            db.execSQL(
                "UPDATE articles SET isSaved = 1 " +
                    "WHERE id IN (SELECT articleId FROM saved_articles)",
            )
            db.execSQL("DROP TABLE saved_articles")
        }
        db.execSQL("ALTER TABLE pending_read_state_mutations ADD COLUMN mutationId TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE pending_read_state_mutations ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")
        db.execSQL("ALTER TABLE pending_read_state_mutations ADD COLUMN baseRevision INTEGER")
        db.execSQL("ALTER TABLE pending_read_state_mutations ADD COLUMN previousState INTEGER")
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS pending_saved_state_mutations (
                articleId TEXT NOT NULL,
                saved INTEGER NOT NULL,
                mutationId TEXT NOT NULL,
                baseRevision INTEGER,
                previousState INTEGER,
                updatedAt INTEGER NOT NULL,
                PRIMARY KEY(articleId)
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS article_state_revisions (
                articleId TEXT NOT NULL,
                readRevision INTEGER,
                savedRevision INTEGER,
                PRIMARY KEY(articleId)
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS preferences (
                `key` TEXT NOT NULL,
                payloadJson TEXT NOT NULL,
                writtenAt INTEGER NOT NULL,
                PRIMARY KEY(`key`)
            )
            """.trimIndent(),
        )
    }
}

private fun SupportSQLiteDatabase.hasTable(tableName: String): Boolean =
    query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        arrayOf(tableName),
    ).use { cursor -> cursor.moveToFirst() }

private fun SupportSQLiteDatabase.hasColumn(tableName: String, columnName: String): Boolean =
    query("PRAGMA table_info(`$tableName`)").use { cursor ->
        val nameColumn = cursor.getColumnIndexOrThrow("name")
        while (cursor.moveToNext()) {
            if (cursor.getString(nameColumn) == columnName) return@use true
        }
        false
    }

val LOCAL_DATABASE_MIGRATIONS: Array<Migration> =
    arrayOf(
        MIGRATION_1_2,
        MIGRATION_2_3,
        MIGRATION_3_4,
        MIGRATION_4_5,
        MIGRATION_5_6,
        MIGRATION_6_7,
    )
