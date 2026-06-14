package com.selffeed.android.data.local

import androidx.room.migration.Migration

const val LOCAL_DATABASE_VERSION = 1

// When bumping LOCAL_DATABASE_VERSION to 2, add a MIGRATION_1_2 object here,
// include it in LOCAL_DATABASE_MIGRATIONS, and add data-preservation coverage
// to LocalDatabaseMigrationTest before shipping the schema change.
val LOCAL_DATABASE_MIGRATIONS: Array<Migration> = emptyArray()
