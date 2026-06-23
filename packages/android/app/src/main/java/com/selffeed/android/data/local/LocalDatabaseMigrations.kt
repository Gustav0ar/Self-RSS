package com.selffeed.android.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

const val LOCAL_DATABASE_VERSION = 2

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE feeds ADD COLUMN lastSyncError TEXT")
        db.execSQL("ALTER TABLE feeds ADD COLUMN lastSyncErrorAt TEXT")
    }
}

val LOCAL_DATABASE_MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_1_2)
