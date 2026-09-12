package com.selffeed.android.data

import android.content.Context
import androidx.lifecycle.viewModelScope
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.data.remote.ArticleRemoteDataSource
import com.selffeed.android.data.remote.AuthRemoteDataSource
import com.selffeed.android.data.remote.FeedRemoteDataSource
import com.selffeed.android.data.remote.SearchRemoteDataSource
import com.selffeed.android.data.remote.SettingsRemoteDataSource
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.network.NetworkMonitor
import com.selffeed.android.network.SessionRefreshCoordinator
import com.selffeed.android.ui.AuthViewModel
import com.selffeed.android.ui.MainDispatcherRule
import com.sun.net.httpserver.HttpServer
import io.mockk.every
import io.mockk.mockk
import io.mockk.spyk
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CookieOnlyBootstrapTest {
    @get:Rule val main = MainDispatcherRule()

    @Test fun cookieOnlyBootstrapUsesTheRealRefreshOffMainWhileMainRemainsResponsive() = runTest {
        val fixture = Fixture(Thread.currentThread())
        val model = AuthViewModel(fixture.repository)
        try {
            model.bootstrap()
            runCurrent()
            assertTrue(withContext(Dispatchers.IO) { fixture.started.await(5, TimeUnit.SECONDS) })
            var responded = false
            launch(Dispatchers.Main) { responded = true }
            runCurrent()
            assertTrue(responded)
            assertTrue(model.state.value.loading)
            assertNull(fixture.store.getAccessToken())
            fixture.release.countDown()
            val state = withContext(Dispatchers.Default) {
                withTimeout(5_000) { model.state.first { !it.loading } }
            }
            assertTrue(state.isAuthenticated)
            assertEquals("reader", state.user?.id)
            assertEquals("refreshed-access", fixture.store.getAccessToken())
        } finally {
            fixture.release.countDown()
            model.viewModelScope.coroutineContext.job.cancelAndJoin()
            fixture.close()
        }
    }

    @Test fun cancellingBootstrapStopsTheRealRefreshBeforeTheServerResponds() = assertCancelledBootstrap(false)

    @Test fun cancellingBootstrapClosesAPartiallyReadRefreshBody() = assertCancelledBootstrap(true)

    private fun assertCancelledBootstrap(blockBody: Boolean) = runTest {
        val fixture = Fixture(Thread.currentThread(), blockBody)
        val model = AuthViewModel(fixture.repository)
        try {
            model.bootstrap()
            runCurrent()
            assertTrue(withContext(Dispatchers.IO) { fixture.started.await(5, TimeUnit.SECONDS) })
            if (blockBody) assertTrue(withContext(Dispatchers.IO) { fixture.bodyStarted.await(5, TimeUnit.SECONDS) })
            val completed = withContext(Dispatchers.Default) {
                withTimeoutOrNull(2_000) {
                    model.viewModelScope.coroutineContext.job.cancelAndJoin()
                    true
                } ?: false
            }
            assertTrue("Cancelling bootstrap must finish without waiting for the refresh response", completed)
            assertTrue(fixture.cancelled.await(1, TimeUnit.SECONDS))
            assertEquals(1L, fixture.release.count)
            assertNull(fixture.store.getAccessToken())
            assertFalse(model.state.value.isAuthenticated)
        } finally {
            fixture.release.countDown()
            model.viewModelScope.coroutineContext.job.cancelAndJoin()
            fixture.close()
        }
    }

    @Test fun aCancelledWaiterDoesNotCancelTheSynchronousRefreshOrBlockTheNextOne() = runTest {
        val fixture = Fixture(Thread.currentThread())
        val synchronous = CompletableFuture.supplyAsync { fixture.coordinator.refreshAccessToken() }
        try {
            assertTrue(withContext(Dispatchers.IO) { fixture.started.await(5, TimeUnit.SECONDS) })
            // Enter with the same dispatcher as refresh, so the coroutine reaches the occupied
            // mutex before async returns instead of merely waiting in a dispatcher queue.
            val waiting = async(Dispatchers.IO, start = CoroutineStart.UNDISPATCHED) {
                fixture.coordinator.refresh(fixture.store.currentSession())
            }
            assertTrue(withContext(Dispatchers.Default) {
                withTimeoutOrNull(2_000) { waiting.cancelAndJoin(); true } ?: false
            })
            assertEquals(1, fixture.requests.get())
            assertEquals(1L, fixture.cancelled.count)
            assertFalse(synchronous.isDone)
            fixture.release.countDown()
            assertEquals(
                com.selffeed.android.network.SessionRefreshResult.Success("refreshed-access"),
                withContext(Dispatchers.IO) { synchronous.get(5, TimeUnit.SECONDS) },
            )
            assertEquals(
                com.selffeed.android.network.SessionRefreshResult.Success("refreshed-access"),
                fixture.coordinator.refresh(fixture.store.currentSession()),
            )
            assertEquals(2, fixture.requests.get())
        } finally {
            fixture.release.countDown()
            withContext(Dispatchers.IO) { synchronous.get(5, TimeUnit.SECONDS) }
            fixture.close()
        }
    }

    private class Fixture(caller: Thread, blockBody: Boolean = false) {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val cancelled = CountDownLatch(1)
        val bodyStarted = CountDownLatch(1)
        val requests = AtomicInteger()
        private val context = ApplicationProvider.getApplicationContext<Context>()
        val store = spyk(SessionStore(context), recordPrivateCalls = true)
        private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        private val executor = Executors.newCachedThreadPool()
        private val background = SupervisorJob()
        private val moshi = NetworkModule.provideMoshi()
        private val refreshClient = OkHttpClient.Builder().eventListener(object : EventListener() {
            override fun callStart(call: Call) {
                assertNotEquals("The real refresh transport must not execute on Main", caller, Thread.currentThread())
            }
            override fun callFailed(call: Call, ioe: java.io.IOException) {
                if (call.isCanceled()) cancelled.countDown()
            }
            override fun responseBodyStart(call: Call) { bodyStarted.countDown() }
        }).build()
        val coordinator = SessionRefreshCoordinator(store, moshi) { refreshClient }
        private val client = NetworkModule.provideOkHttpClient(context, store, coordinator)
        val repository: RssRepository

        init {
            every { store["masterKeyKey"]() } returns SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")
            server.executor = executor
            server.createContext("/api/v1/auth/refresh") { exchange ->
                requests.incrementAndGet()
                val bytes = """{"data":{"tokens":{"accessToken":"refreshed-access"}}}""".toByteArray()
                if (blockBody) {
                    exchange.sendResponseHeaders(200, bytes.size.toLong())
                    exchange.responseBody.write(bytes, 0, 1)
                    exchange.responseBody.flush()
                }
                started.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                if (!blockBody) exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use {
                    if (blockBody) it.write(bytes, 1, bytes.size - 1) else it.write(bytes)
                }
            }
            server.createContext("/api/v1/auth/me") { exchange ->
                val bytes = """{"data":{"id":"reader","email":"reader@example.invalid","role":"user","isActive":true}}""".toByteArray()
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
            server.start()
            runBlocking {
                store.setApiBaseUrl("127.0.0.1:${server.address.port}")
                store.setRefreshCookie("rss_refresh_token=stored-cookie; Path=/api/v1/auth")
            }
            val api = NetworkModule.provideApi(client, moshi, store)
            val monitor = mockk<NetworkMonitor> { every { online } returns MutableStateFlow(false) }
            repository = RssRepository(
                AuthRemoteDataSource(api), FeedRemoteDataSource(api), ArticleRemoteDataSource(api),
                SearchRemoteDataSource(api), SettingsRemoteDataSource(api), store, coordinator,
                client, moshi, mockk(relaxed = true), mockk(relaxed = true), context,
                mockk(relaxed = true), monitor, CoroutineScope(background + Dispatchers.IO),
            )
        }

        suspend fun close() {
            release.countDown()
            background.cancelAndJoin()
            server.stop(0)
            executor.shutdownNow()
            client.cache?.close()
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdownNow()
            refreshClient.connectionPool.evictAll()
            refreshClient.dispatcher.executorService.shutdownNow()
        }
    }
}
