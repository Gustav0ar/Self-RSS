package com.selffeed.android.data

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import com.selffeed.android.di.ApplicationCoroutineScope
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class PreparedOpmlExport internal constructor(val uri: Uri, internal val file: File)

/** Owns temporary exports independently of an Activity and serializes file maintenance. */
@Singleton
class OpmlExportStore @Inject constructor(
    @ApplicationContext context: Context,
    @ApplicationCoroutineScope private val applicationScope: CoroutineScope,
) {
    private val application = context.applicationContext
    private val files = Mutex()
    private val pending = mutableSetOf<File>()

    suspend fun prepare(content: String): PreparedOpmlExport {
        var created: File? = null
        try {
            return withContext(Dispatchers.IO) {
                files.withLock {
                    val directory = File(application.cacheDir, "shared")
                    directory.mkdirs()
                    reap(directory)
                    val file = File.createTempFile("rss-feeds-", ".opml", directory)
                    created = file
                    runInterruptible { file.writeText(content) }
                    currentCoroutineContext().ensureActive()
                    val uri = FileProvider.getUriForFile(application, "${application.packageName}.provider", file)
                    pending.add(file)
                    PreparedOpmlExport(uri, file)
                }
            }
        } catch (error: Exception) {
            // A cancelled return from withContext must not orphan its newly created file.
            withContext(NonCancellable + Dispatchers.IO) {
                files.withLock { created?.let { pending.remove(it); runCatching { it.delete() } } }
            }
            throw error
        }
    }

    /** Complete this durable retention update before granting the URI to another app. */
    suspend fun renewRetention(export: PreparedOpmlExport) = withContext(Dispatchers.IO) {
        files.withLock {
            check(export.file in pending)
            if (!export.file.setLastModified(System.currentTimeMillis())) {
                throw IOException("The prepared OPML file is no longer available")
            }
        }
    }

    /** A chooser provides no reliable notification that its recipient finished reading. */
    fun release(export: PreparedOpmlExport, shared: Boolean) {
        applicationScope.launch {
            withContext(Dispatchers.IO) {
                files.withLock {
                    if (!pending.remove(export.file)) return@withLock
                    // Shared files expire during later maintenance, never on a short deletion timer.
                    if (!shared) runCatching { export.file.delete() }
                }
            }
        }
    }

    suspend fun reapStaleExports() = withContext(Dispatchers.IO) {
        files.withLock { reap(File(application.cacheDir, "shared")) }
    }

    private fun reap(directory: File) {
        val cutoff = System.currentTimeMillis() - RETENTION_MS
        runCatching { directory.listFiles() }.getOrNull()?.forEach { file ->
            if (file !in pending && OWNED_NAME.matches(file.name)) {
                runCatching { if (file.isFile && file.lastModified() < cutoff) file.delete() }
            }
        }
    }

    private companion object {
        const val RETENTION_MS = 24 * 60 * 60_000L
        // Also recognizes the timestamp names written by older app versions.
        val OWNED_NAME = Regex("rss-feeds-[0-9]+\\.opml")
    }
}
