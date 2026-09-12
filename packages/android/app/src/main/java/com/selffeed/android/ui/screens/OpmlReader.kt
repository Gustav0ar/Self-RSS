package com.selffeed.android.ui.screens

import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext

data class OpmlImportFile(val fileName: String, val bytes: ByteArray)

/** The feature can retain this reader across recreation without retaining an Activity. */
class OpmlDocumentReader @Inject constructor(@ApplicationContext context: Context) {
    private val application = context.applicationContext

    suspend fun read(uri: Uri): OpmlImportFile? {
        val cancellation = CancellationSignal()
        val bytes = readBoundedOpml(cancelOpen = cancellation::cancel) {
            val descriptor = application.contentResolver.openAssetFileDescriptor(uri, "r", cancellation)
                ?: return@readBoundedOpml null
            try {
                descriptor.createInputStream()
            } catch (error: Exception) {
                runCatching { descriptor.close() }
                throw error
            }
        } ?: return null
        return OpmlImportFile(uri.lastPathSegment?.substringAfterLast('/') ?: "feeds.opml", bytes)
    }
}

/** Closes blocked reads on cancellation; interrupt alone does not release Android pipes. */
internal suspend fun readBoundedOpml(
    cancelOpen: () -> Unit = {},
    openInput: () -> InputStream?,
): ByteArray? = coroutineScope {
    val ownedInput = AtomicReference<InputStream?>()
    val reader = async(Dispatchers.IO) {
        runInterruptible {
            try {
                val input = openInput() ?: return@runInterruptible null
                ownedInput.set(input)
                try {
                    coroutineContext.ensureActive()
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var total = 0
                    while (true) {
                        coroutineContext.ensureActive()
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_OPML_BYTES) return@runInterruptible null
                        output.write(buffer, 0, read)
                    }
                    output.toByteArray()
                } finally {
                    ownedInput.getAndSet(null)?.close()
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                null
            }
        }
    }
    try {
        reader.await()
    } catch (error: CancellationException) {
        // Await cancels before the IO child has finished. Closing from another
        // IO thread releases a native read that does not respond to interruption.
        withContext(NonCancellable + Dispatchers.IO) {
            runCatching { cancelOpen() }
            runCatching { ownedInput.getAndSet(null)?.close() }
        }
        throw error
    }
}

private const val MAX_OPML_BYTES = 5 * 1024 * 1024
