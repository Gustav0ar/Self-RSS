package com.selffeed.android.di

import android.content.Context
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.disk.DiskCache
import coil3.disk.directory
import com.selffeed.android.data.RssRepository
import com.selffeed.android.data.SessionStore
import com.selffeed.android.data.local.CompositeOfflineReadStore
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.data.local.OfflineCacheStore
import com.selffeed.android.data.local.OfflineReadStore
import com.selffeed.android.data.repository.AppStatusRepository
import com.selffeed.android.data.repository.AppStatusRepositoryImpl
import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.data.repository.ArticleRepositoryImpl
import com.selffeed.android.data.repository.AuthRepository
import com.selffeed.android.data.repository.AuthRepositoryImpl
import com.selffeed.android.data.repository.FeedRepository
import com.selffeed.android.data.repository.FeedRepositoryImpl
import com.selffeed.android.data.repository.SearchRepository
import com.selffeed.android.data.repository.SearchRepositoryImpl
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.data.repository.SettingsRepository
import com.selffeed.android.data.repository.SettingsRepositoryImpl
import com.selffeed.android.network.AndroidNetworkMonitor
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.network.RssApi
import com.selffeed.android.network.SessionRefreshCoordinator
import com.squareup.moshi.Moshi
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath
import java.io.File
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideSessionStore(@ApplicationContext context: Context): SessionStore = SessionStore(context)

    @Provides
    @Singleton
    fun provideMoshi(): Moshi = NetworkModule.provideMoshi()

    @Provides
    @Singleton
    fun provideSessionRefreshCoordinator(
        sessionStore: SessionStore,
        moshi: Moshi,
    ): SessionRefreshCoordinator = SessionRefreshCoordinator(sessionStore, moshi)

    @Provides
    @Singleton
    fun provideOkHttpClient(
        @ApplicationContext context: Context,
        sessionStore: SessionStore,
        sessionRefreshCoordinator: SessionRefreshCoordinator,
    ): OkHttpClient = NetworkModule.provideOkHttpClient(
        context,
        sessionStore,
        sessionRefreshCoordinator,
    )

    @Provides
    @Singleton
    fun provideApi(client: OkHttpClient, moshi: Moshi): RssApi =
        NetworkModule.provideApi(client, moshi)

    @Provides
    @Singleton
    fun provideOfflineCacheStore(
        @ApplicationContext context: Context,
        moshi: Moshi,
    ): OfflineCacheStore = OfflineCacheStore(context, moshi)

    @Provides
    @Singleton
    fun provideLocalStore(
        @ApplicationContext context: Context,
        moshi: Moshi,
    ): LocalStore = LocalStore(context, moshi)

    @Provides
    @Singleton
    fun provideOfflineReadStore(
        localStore: LocalStore,
        offlineCacheStore: OfflineCacheStore,
    ): OfflineReadStore = CompositeOfflineReadStore(localStore, offlineCacheStore)

    @Provides
    @Singleton
    fun provideNetworkMonitor(@ApplicationContext context: Context): NetworkMonitor =
        AndroidNetworkMonitor(context)

    @Provides
    @Singleton
    fun provideImageLoader(@ApplicationContext context: Context): ImageLoader =
        createImageLoader(context)

    @Provides
    fun provideImageRequestContext(@ApplicationContext context: Context): Context = context

    fun createImageLoader(context: PlatformContext): ImageLoader {
        val diskCacheDir = File(context.cacheDir, "image_cache").toOkioPath()
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

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryBindingModule {
    @Binds
    @Singleton
    abstract fun bindSelfFeedRepository(repository: RssRepository): SelfFeedRepository

    @Binds
    abstract fun bindAuthRepository(repository: AuthRepositoryImpl): AuthRepository

    @Binds
    abstract fun bindFeedRepository(repository: FeedRepositoryImpl): FeedRepository

    @Binds
    abstract fun bindArticleRepository(repository: ArticleRepositoryImpl): ArticleRepository

    @Binds
    abstract fun bindSearchRepository(repository: SearchRepositoryImpl): SearchRepository

    @Binds
    abstract fun bindSettingsRepository(repository: SettingsRepositoryImpl): SettingsRepository

    @Binds
    abstract fun bindAppStatusRepository(repository: AppStatusRepositoryImpl): AppStatusRepository
}
