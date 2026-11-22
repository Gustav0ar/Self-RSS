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
import com.selffeed.android.data.ArticleStateSyncWorker
import com.selffeed.android.data.OfflineContentSyncWorker
import com.selffeed.android.data.RssRepository
import com.selffeed.android.data.OpmlExportStore
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.di.AppModule
import com.selffeed.android.di.ApplicationCoroutineScope
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.ui.AppShortcuts
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

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

    @Inject
    @ApplicationCoroutineScope
    lateinit var applicationScope: CoroutineScope

    @Inject
    lateinit var opmlExports: OpmlExportStore

    override val workManagerConfiguration: WorkConfiguration
        get() = WorkConfiguration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()
        // Keep binder IPC (ShortcutManager) and WorkManager initialization off
        // the cold-start main thread so MainActivity can render immediately.
        applicationScope.launch {
            AppShortcuts.publish(this@SelfFeedApplication)
            opmlExports.reapStaleExports()
            FeedSyncWorker.schedule(this@SelfFeedApplication)
            repository.withAuthenticatedAccount {
                FeedSyncWorker.ensureScheduled(this@SelfFeedApplication)
                ArticleStateSyncWorker.ensureScheduled(this@SelfFeedApplication)
                ArticleStateSyncWorker.ensureScheduled(this@SelfFeedApplication, downloadSaved = true)
                OfflineContentSyncWorker.ensureScheduled(this@SelfFeedApplication)
            }
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
        // Android 14+ (API 34+) only dispatches TRIM_MEMORY_UI_HIDDEN and
        // TRIM_MEMORY_BACKGROUND; TRIM_MEMORY_RUNNING_* levels are deprecated.
        if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
            repository.trimMemoryCaches()
        }
        if (level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND && ::imageLoader.isInitialized) {
            imageLoader.memoryCache?.clear()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
    }
}
