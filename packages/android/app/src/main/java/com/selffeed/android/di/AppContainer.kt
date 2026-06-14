package com.selffeed.android.di

import android.content.Context
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.disk.DiskCache
import coil3.disk.directory
import com.selffeed.android.data.FeedSyncWorker
import com.selffeed.android.data.RssRepository
import com.selffeed.android.data.SessionStore
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.local.OfflineCacheStore
import com.selffeed.android.data.repository.AppStatusRepositoryImpl
import com.selffeed.android.data.repository.ArticleRepositoryImpl
import com.selffeed.android.data.repository.AuthRepositoryImpl
import com.selffeed.android.data.repository.FeedRepositoryImpl
import com.selffeed.android.data.repository.SearchRepositoryImpl
import com.selffeed.android.data.repository.SettingsRepositoryImpl
import com.selffeed.android.data.repository.AppStatusRepository
import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.data.repository.AuthRepository
import com.selffeed.android.data.repository.FeedRepository
import com.selffeed.android.data.repository.SearchRepository
import com.selffeed.android.data.repository.SettingsRepository
import com.selffeed.android.network.AndroidNetworkMonitor
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.NetworkMonitor
import okio.Path.Companion.toOkioPath
import java.io.File

class AppContainer(
    private val appContext: Context,
) {
    val sessionStore: SessionStore by lazy { SessionStore(appContext) }
    val moshi by lazy { NetworkModule.provideMoshi() }
    val okHttp by lazy { NetworkModule.provideOkHttpClient(appContext, sessionStore, moshi) }
    val api by lazy { NetworkModule.provideApi(okHttp, moshi) }
    val offlineCacheStore: OfflineCacheStore by lazy { OfflineCacheStore(appContext, moshi) }
    val networkMonitor: NetworkMonitor by lazy { AndroidNetworkMonitor(appContext) }
    val localStore: LocalStore by lazy { LocalStore(appContext, moshi) }
    val imageLoader: ImageLoader by lazy { createImageLoader(appContext) }

    val repository: RssRepository by lazy {
        RssRepository(
            api = api,
            sessionStore = sessionStore,
            okHttpClient = okHttp,
            moshi = moshi,
            offlineCacheStore = offlineCacheStore,
            localStore = localStore,
            imageRequestContext = appContext,
            imageLoader = imageLoader,
            networkMonitor = networkMonitor,
        )
    }
    val authRepository: AuthRepository by lazy { AuthRepositoryImpl(repository) }
    val feedRepository: FeedRepository by lazy { FeedRepositoryImpl(repository) }
    val articleRepository: ArticleRepository by lazy { ArticleRepositoryImpl(repository) }
    val searchRepository: SearchRepository by lazy { SearchRepositoryImpl(repository) }
    val settingsRepository: SettingsRepository by lazy { SettingsRepositoryImpl(repository) }
    val appStatusRepository: AppStatusRepository by lazy { AppStatusRepositoryImpl(repository) }

    fun scheduleBackgroundSync() {
        FeedSyncWorker.schedule(appContext)
        if (repository.isLoggedIn()) {
            FeedSyncWorker.kickOnce(appContext)
        }
    }

    fun createImageLoader(context: PlatformContext): ImageLoader {
        val diskCacheDir = File(appContext.cacheDir, "image_cache").toOkioPath()
        return ImageLoader.Builder(context)
            .diskCache {
                DiskCache.Builder()
                    .directory(diskCacheDir)
                    .maxSizeBytes(50L * 1024 * 1024)
                    .build()
            }
            .build()
    }
}
