package com.selffeed.android.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

const val LOCAL_DATABASE_VERSION = 3

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

val LOCAL_DATABASE_MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_1_2, MIGRATION_2_3)
