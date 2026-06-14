package com.selffeed.android

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import com.selffeed.android.data.RssRepository
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.di.AppContainer
import com.selffeed.android.network.NetworkMonitor

class SelfFeedApplication : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    lateinit var repository: RssRepository
        private set

    lateinit var networkMonitor: NetworkMonitor
        private set

    lateinit var localStore: LocalStore
        private set

    override fun onCreate() {
        super.onCreate()
        com.selffeed.android.ui.components.reapStaleOpmlExports(this)

        container = AppContainer(this)
        repository = container.repository
        networkMonitor = container.networkMonitor
        localStore = container.localStore

        container.scheduleBackgroundSync()
    }

    /**
     * Global Coil 3 [ImageLoader] with bounded memory and disk caches.
     * The default Coil loader has a 25%-of-heap memory cap which is too
     * large for the article-list thumb workload — we cap at 15% of
     * runtime max heap, with a hard floor of 4 MB.
     */
    override fun newImageLoader(context: PlatformContext): ImageLoader {
        return if (::container.isInitialized) {
            container.createImageLoader(context)
        } else {
            AppContainer(this).createImageLoader(context)
        }
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
