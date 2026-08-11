package com.selffeed.android.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

const val LOCAL_DATABASE_VERSION = 6

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

val LOCAL_DATABASE_MIGRATIONS: Array<Migration> =
    arrayOf(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6)
