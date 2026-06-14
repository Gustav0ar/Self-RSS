package com.selffeed.android

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration as WorkConfiguration
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import com.selffeed.android.data.FeedSyncWorker
import com.selffeed.android.data.RssRepository
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.di.AppModule
import com.selffeed.android.network.NetworkMonitor
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class SelfFeedApplication : Application(), SingletonImageLoader.Factory, WorkConfiguration.Provider {
    @Inject
    lateinit var repository: RssRepository

    @Inject
    lateinit var networkMonitor: NetworkMonitor

    @Inject
    lateinit var localStore: LocalStore

    @Inject
    lateinit var imageLoader: ImageLoader

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: WorkConfiguration
        get() = WorkConfiguration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()
        com.selffeed.android.ui.components.reapStaleOpmlExports(this)

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
        return if (::imageLoader.isInitialized) {
            imageLoader
        } else {
            AppModule.createImageLoader(context)
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
