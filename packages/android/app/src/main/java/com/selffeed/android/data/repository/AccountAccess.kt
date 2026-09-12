package com.selffeed.android.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow

/** Immutable admission for a feature lifetime, including work started after replacement. */
interface AccountAccess {
    val ownerId: String
    fun isCurrent(): Boolean
    suspend fun <T> withAccount(block: suspend () -> T): T

    fun <T> read(block: () -> T?): T? {
        if (!isCurrent()) return null
        val result = block()
        return result.takeIf { isCurrent() }
    }

    fun <T> observe(source: () -> Flow<T>): Flow<T> = flow {
        this@AccountAccess.withAccount { emitAll(source()) }
    }
}
