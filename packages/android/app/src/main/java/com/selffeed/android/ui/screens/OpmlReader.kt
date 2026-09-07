package com.selffeed.android.ui.screens

import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible

/** Opens and reads provider data off main; cancellation never becomes an import error. */
internal suspend fun readBoundedOpml(openInput: () -> InputStream?): ByteArray? =
    runInterruptible(Dispatchers.IO) {
        try {
            openInput()?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > MAX_OPML_BYTES) return@runInterruptible null
                    output.write(buffer, 0, read)
                }
                output.toByteArray()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            null
        }
    }

private const val MAX_OPML_BYTES = 5 * 1024 * 1024
