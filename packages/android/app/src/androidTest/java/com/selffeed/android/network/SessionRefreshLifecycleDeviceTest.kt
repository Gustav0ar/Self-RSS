package com.selffeed.android.network

import android.content.Context
import android.os.Looper
import android.os.StrictMode
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import com.selffeed.android.data.SessionStore
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@SdkSuppress(minSdkVersion = 28)
class SessionRefreshLifecycleDeviceTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun cancellingBeforeHeadersClosesTheAndroidSocket() = cancelRefresh(blockBody = false)

    @Test fun cancellingAStalledBodyClosesTheAndroidSocket() = cancelRefresh(blockBody = true)

    private fun cancelRefresh(blockBody: Boolean) = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val preferencesJob = SupervisorJob()
        val preferences = PreferenceDataStoreFactory.create(
            scope = CoroutineScope(preferencesJob + Dispatchers.IO),
            produceFile = { temporary.root.resolve("refresh.preferences_pb") },
        )
        val store = SessionStore(context, dataStore = preferences)
        val cancelled = CountDownLatch(1)
        val bodyStarted = CountDownLatch(1)
        val violations = CopyOnWriteArrayList<android.os.strictmode.Violation>()
        val client = OkHttpClient.Builder().eventListener(object : EventListener() {
            override fun callStart(call: Call) { assertNotEquals(Looper.getMainLooper(), Looper.myLooper()) }
            override fun responseBodyStart(call: Call) { bodyStarted.countDown() }
            override fun callFailed(call: Call, ioe: java.io.IOException) {
                if (call.isCanceled()) cancelled.countDown()
            }
        }).build()
        val server = StalledRefreshServer(blockBody)
        val coordinator = SessionRefreshCoordinator(store, NetworkModule.provideMoshi()) { client }
        store.setApiBaseUrl("127.0.0.1:${server.port}")
        store.setRefreshCookie("rss_refresh_token=fixture-cookie; Path=/api/v1/auth")
        var published = false
        val refresh = launch(Dispatchers.Main) {
            val previous = StrictMode.getThreadPolicy()
            StrictMode.setThreadPolicy(
                StrictMode.ThreadPolicy.Builder().detectDiskReads().detectDiskWrites().detectNetwork()
                    .penaltyListener({ command -> command.run() }) { violations.add(it) }.build(),
            )
            try {
                coordinator.refresh(store.currentSession())
                published = true
            } finally { StrictMode.setThreadPolicy(previous) }
        }
        try {
            assertTrue(withContext(Dispatchers.IO) { server.started.await(5, TimeUnit.SECONDS) })
            if (blockBody) assertTrue(withContext(Dispatchers.IO) { bodyStarted.await(5, TimeUnit.SECONDS) })
            val responsive = CompletableDeferred<Unit>()
            launch(Dispatchers.Main) { responsive.complete(Unit) }
            withTimeout(2_000) { responsive.await() }
            withTimeout(2_000) { refresh.cancelAndJoin() }
            assertTrue(cancelled.await(1, TimeUnit.SECONDS))
            InstrumentationRegistry.getInstrumentation().runOnMainSync { }
            assertEquals(emptyList<android.os.strictmode.Violation>(), violations.toList())
            assertFalse(published)
            assertNull(store.getAccessToken())
        } finally {
            server.close()
            refresh.cancelAndJoin()
            preferencesJob.cancelAndJoin()
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdownNow()
        }
    }

    /** Holds either headers or body until cleanup, without a sleep or a remote service. */
    private class StalledRefreshServer(blockBody: Boolean) : AutoCloseable {
        val started = CountDownLatch(1)
        private val release = CountDownLatch(1)
        private val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        private val executor = Executors.newSingleThreadExecutor()
        @Volatile private var socket: Socket? = null
        val port: Int get() = server.localPort
        private val request = executor.submit {
            server.accept().use { connection ->
                socket = connection
                connection.soTimeout = 5_000
                val input = connection.getInputStream().bufferedReader(Charsets.US_ASCII)
                check(input.readLine() == "POST /api/v1/auth/refresh HTTP/1.1")
                while (true) {
                    val line = input.readLine() ?: error("Missing request headers")
                    if (line.isEmpty()) break
                }
                if (blockBody) {
                    connection.getOutputStream().apply {
                        write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{".toByteArray())
                        flush()
                    }
                }
                started.countDown()
                check(release.await(10, TimeUnit.SECONDS))
            }
        }

        override fun close() {
            release.countDown()
            server.close()
            socket?.close()
            try { request.get(5, TimeUnit.SECONDS) } finally { executor.shutdownNow() }
        }
    }
}
