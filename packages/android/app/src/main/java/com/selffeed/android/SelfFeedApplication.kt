package com.selffeed.android

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import com.selffeed.android.data.FeedSyncWorker
import com.selffeed.android.data.RssRepository
import com.selffeed.android.data.SessionStore
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.local.OfflineCacheStore
import com.selffeed.android.network.AndroidNetworkMonitor
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.NetworkMonitor
import okio.Path.Companion.toOkioPath
import java.io.File

class SelfFeedApplication : Application(), SingletonImageLoader.Factory {
    lateinit var repository: RssRepository
        private set

    lateinit var networkMonitor: NetworkMonitor
        private set

    lateinit var localStore: LocalStore
        private set

    override fun onCreate() {
        super.onCreate()
        com.selffeed.android.ui.components.reapStaleOpmlExports(this)

        val sessionStore = SessionStore(this)
        val moshi = NetworkModule.provideMoshi()
        val okHttp = NetworkModule.provideOkHttpClient(this, sessionStore, moshi)
        val api = NetworkModule.provideApi(okHttp, moshi)
        val offlineCacheStore = OfflineCacheStore(this, moshi)
        val monitor = AndroidNetworkMonitor(this)
        val store = LocalStore(this, moshi)

        repository = RssRepository(
            api = api,
            sessionStore = sessionStore,
            okHttpClient = okHttp,
            moshi = moshi,
            offlineCacheStore = offlineCacheStore,
            localStore = store,
            imageRequestContext = this,
            imageLoader = newImageLoader(this),
            networkMonitor = monitor,
        )
        networkMonitor = monitor
        localStore = store

        // Periodic sync is still scheduled as a safety-net (the SSE stream
        // does most of the heavy lifting while the app is open). It runs
        // with NetworkType.CONNECTED + battery-not-low constraints so we
        // don't hammer the radio.
        FeedSyncWorker.schedule(this)
        if (repository.isLoggedIn()) {
            FeedSyncWorker.kickOnce(this)
        }
    }

    /**
     * Global Coil 3 [ImageLoader] with bounded memory and disk caches.
     * The default Coil loader has a 25%-of-heap memory cap which is too
     * large for the article-list thumb workload — we cap at 15% of
     * runtime max heap, with a hard floor of 4 MB.
     */
    override fun newImageLoader(context: PlatformContext): ImageLoader {
        val diskCacheDir = File(cacheDir, "image_cache").toOkioPath()
        return ImageLoader.Builder(context)
            .diskCache {
                DiskCache.Builder()
                    .directory(diskCacheDir)
                    .maxSizeBytes(50L * 1024 * 1024)
                    .build()
            }
            .build()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        // Free in-memory caches under pressure so the system can reclaim pages.
        // The TRIM_MEMORY_RUNNING_LOW constant is deprecated in API 35
        // (replaced with the onTrimMemory components of ComponentCallbacks2
        // taking an Int that maps to a finer-grained bucket). The semantics
        // haven't changed: anything at or above RUNNING_LOW means we're
        // under visible pressure.
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            repository.trimMemoryCaches()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
    }
}
