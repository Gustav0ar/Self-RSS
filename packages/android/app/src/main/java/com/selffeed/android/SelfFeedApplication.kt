package com.selffeed.android

import android.app.Application
import com.selffeed.android.data.FeedSyncWorker
import com.selffeed.android.data.RssRepository
import com.selffeed.android.data.SessionStore
import com.selffeed.android.data.local.OfflineCacheStore
import com.selffeed.android.network.NetworkModule

class SelfFeedApplication : Application() {
    lateinit var repository: RssRepository
        private set

    override fun onCreate() {
        super.onCreate()

        val sessionStore = SessionStore(this)
        val moshi = NetworkModule.provideMoshi()
        val okHttp = NetworkModule.provideOkHttpClient(sessionStore, moshi)
        val api = NetworkModule.provideApi(okHttp, moshi)
        val offlineCacheStore = OfflineCacheStore(this, moshi)

        repository = RssRepository(
            api = api,
            sessionStore = sessionStore,
            okHttpClient = okHttp,
            moshi = moshi,
            offlineCacheStore = offlineCacheStore,
        )
        FeedSyncWorker.schedule(this)
    }
}
