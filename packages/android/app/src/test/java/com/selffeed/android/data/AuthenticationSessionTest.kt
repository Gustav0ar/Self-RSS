package com.selffeed.android.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.data.remote.ArticleRemoteDataSource
import com.selffeed.android.data.remote.AuthRemoteDataSource
import com.selffeed.android.data.remote.FeedRemoteDataSource
import com.selffeed.android.data.remote.SearchRemoteDataSource
import com.selffeed.android.data.remote.SettingsRemoteDataSource
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.network.SessionRefreshCoordinator
import com.selffeed.android.network.SessionRefreshResult
import com.sun.net.httpserver.HttpServer
import io.mockk.every
import io.mockk.mockk
import io.mockk.spyk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.InetSocketAddress
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.spec.SecretKeySpec

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AuthenticationSessionTest {
    @Test
    fun `old account refresh cannot overwrite a new login`() = authenticateWhileOldRefreshIsPending("login")

    @Test
    fun `old account refresh cannot overwrite a new registration`() = authenticateWhileOldRefreshIsPending("register")

    private fun authenticateWhileOldRefreshIsPending(endpoint: String) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = spyk(SessionStore(context), recordPrivateCalls = true)
        // Replace only AndroidKeyStore lookup; encryption, DataStore and session guards remain real.
        every { store["masterKeyKey"]() } returns SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val executor = Executors.newCachedThreadPool()
        server.executor = executor
        val oldRefreshStarted = CountDownLatch(1)
        val finishOldRefresh = CountDownLatch(1)
        server.createContext("/api/v1/auth/refresh") { exchange ->
            val old = exchange.requestHeaders.getFirst("Cookie").contains("old-account")
            if (old) {
                oldRefreshStarted.countDown()
                check(finishOldRefresh.await(5, TimeUnit.SECONDS))
            }
            val token = if (old) "old-account-refreshed" else "new-account-refreshed"
            exchange.responseHeaders.add("Set-Cookie", "rss_refresh_token=$token; Path=/api/v1/auth")
            val body = """{"data":{"tokens":{"accessToken":"$token"}}}""".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.createContext("/api/v1/auth/$endpoint") { exchange ->
            exchange.responseHeaders.add("Set-Cookie", "rss_refresh_token=new-account; Path=/api/v1/auth")
            val body = """{"data":{"user":{"id":"new","email":"new@example.com","role":"user","isActive":true},"tokens":{"accessToken":"new-account"}}}""".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        runBlocking {
            store.setApiBaseUrl("127.0.0.1:${server.address.port}")
            store.setAccessToken("old-account")
            store.setRefreshCookie("rss_refresh_token=old-account; Path=/api/v1/auth")
        }
        val oldSession = store.currentSession()
        val moshi = NetworkModule.provideMoshi()
        val coordinator = SessionRefreshCoordinator(store, moshi)
        val client = NetworkModule.provideOkHttpClient(context, store, coordinator)
        val api = NetworkModule.provideApi(client, moshi, store)
        val monitor = mockk<NetworkMonitor> {
            every { online } returns MutableStateFlow(false)
        }
        val backgroundJob = kotlinx.coroutines.SupervisorJob()
        val repository = RssRepository(
            AuthRemoteDataSource(api), FeedRemoteDataSource(api), ArticleRemoteDataSource(api),
            SearchRemoteDataSource(api), SettingsRemoteDataSource(api), store, coordinator,
            client, moshi, mockk(relaxed = true), mockk(relaxed = true), context,
            mockk(relaxed = true), monitor,
            kotlinx.coroutines.CoroutineScope(backgroundJob + kotlinx.coroutines.Dispatchers.IO),
        )
        try {
            val refresh = CompletableFuture.supplyAsync { coordinator.refreshAccessToken() }
            assertTrue(oldRefreshStarted.await(5, TimeUnit.SECONDS))
            val result = runBlocking {
                if (endpoint == "login") repository.login("new@example.com", "password")
                else repository.register("new@example.com", "password")
            }
            assertTrue(result is AppResult.Success)
            assertEquals("new-account", store.getAccessToken())
            assertTrue(store.getRefreshCookie().orEmpty().contains("new-account"))
            finishOldRefresh.countDown()
            val oldRefreshResult = refresh.get(5, TimeUnit.SECONDS)
            assertEquals("new-account", store.getAccessToken())
            assertTrue(oldRefreshResult is SessionRefreshResult.Unavailable)
            assertFalse(store.isCurrentSession(oldSession))
            assertTrue(store.getRefreshCookie().orEmpty().contains("new-account"))

            val newSession = store.currentSession()
            assertEquals(SessionRefreshResult.Success("new-account-refreshed"), coordinator.refreshAccessToken())
            assertEquals(newSession, store.currentSession())
            assertTrue(store.getRefreshCookie().orEmpty().contains("new-account-refreshed"))
        } finally {
            runBlocking { backgroundJob.cancel(); backgroundJob.join() }
            finishOldRefresh.countDown()
            server.stop(0)
            executor.shutdownNow()
            client.cache?.close()
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdownNow()
        }
    }
}
