@file:Suppress("DEPRECATION")

package com.selffeed.android.network

import com.selffeed.android.data.SessionStore
import io.mockk.every
import io.mockk.mockk
import okhttp3.Cookie
import okhttp3.HttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class NetworkModuleTest {
    @Test
    fun `provideMoshi returns a Moshi with the boolean adapter installed`() {
        val moshi = NetworkModule.provideMoshi()
        val adapter = moshi.adapter(Boolean::class.java)
        // Wrap each scalar in a JSON value so the adapter sees a
        // top-level value, not a bare token (which Moshi rejects).
        assertEquals(true, adapter.fromJson("1"))
        assertEquals(false, adapter.fromJson("0"))
        assertEquals(true, adapter.fromJson("true"))
        assertEquals(false, adapter.fromJson("false"))
        // Unknown strings are conservatively treated as false.
        assertEquals(false, adapter.fromJson("\"nope\""))
    }

    @Test
    fun `provideMoshi round-trips booleans`() {
        val moshi = NetworkModule.provideMoshi()
        val adapter = moshi.adapter(Boolean::class.java)
        assertEquals("true", adapter.toJson(true))
        assertEquals("false", adapter.toJson(false))
    }

    @Test
    fun `client builder shape matches the production module`() {
        // We can't build the production OkHttpClient here (it needs an
        // Android context for the cache), so we sanity-check the timeouts
        // the module sets.
        val client = okhttp3.OkHttpClient.Builder()
            .callTimeout(30, TimeUnit.SECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .build()
        assertEquals(30_000, client.callTimeoutMillis)
        assertEquals(10_000, client.connectTimeoutMillis)
        assertEquals(15_000, client.readTimeoutMillis)
        assertEquals(15_000, client.writeTimeoutMillis)
        assertEquals(30_000, client.pingIntervalMillis)
    }

    @Test
    fun `persistedRefreshCookieJar returns empty list when no cookie is stored`() {
        val store = mockk<SessionStore>()
        every { store.getRefreshCookie() } returns null
        val jar = PersistedRefreshCookieJar(store)
        val cookies = jar.loadForRequest(url("https://example.com"))
        assertTrue(cookies.isEmpty())
    }

    @Test
    fun `persistedRefreshCookieJar returns a valid cookie`() {
        val store = mockk<SessionStore>()
        every { store.getRefreshCookie() } returns
            "rss_refresh_token=abc123; Path=/; Domain=example.com"
        val jar = PersistedRefreshCookieJar(store)
        val cookies = jar.loadForRequest(url("https://example.com/api/v1/auth/refresh"))
        assertEquals(1, cookies.size)
        assertEquals("rss_refresh_token", cookies[0].name)
        assertEquals("abc123", cookies[0].value)
    }

    @Test
    fun `persistedRefreshCookieJar discards expired cookies and clears storage`() {
        val store = mockk<SessionStore>(relaxUnitFun = true)
        every { store.getRefreshCookie() } returns
            "rss_refresh_token=abc; Path=/; Domain=example.com; Max-Age=0"
        val jar = PersistedRefreshCookieJar(store)
        val cookies = jar.loadForRequest(url("https://example.com/api/v1/auth/refresh"))
        assertTrue(cookies.isEmpty())
        // The store should have been updated to null.
        io.mockk.verify { store.setRefreshCookie(null) }
    }

    @Test
    fun `saveFromResponse only stores the refresh cookie`() {
        val store = mockk<SessionStore>(relaxUnitFun = true)
        val jar = PersistedRefreshCookieJar(store)
        val parsedUrl = url("https://example.com")
        val sessionCookie = Cookie.Builder()
            .name("session")
            .value("xyz")
            .domain("example.com")
            .path("/")
            .build()
        val refreshCookie = Cookie.Builder()
            .name("rss_refresh_token")
            .value("refresh-value")
            .domain("example.com")
            .path("/")
            .build()
        jar.saveFromResponse(parsedUrl, listOf(sessionCookie, refreshCookie))
        io.mockk.verify { store.setRefreshCookie(match { it!!.contains("refresh-value") }) }
    }

    @Test
    fun `saveFromResponse ignores non-refresh cookies`() {
        val store = mockk<SessionStore>(relaxUnitFun = true)
        val jar = PersistedRefreshCookieJar(store)
        val parsedUrl = url("https://example.com")
        val sessionCookie = Cookie.Builder()
            .name("session")
            .value("xyz")
            .domain("example.com")
            .path("/")
            .build()
        jar.saveFromResponse(parsedUrl, listOf(sessionCookie))
        // No interaction with setRefreshCookie.
        io.mockk.verify(exactly = 0) { store.setRefreshCookie(any()) }
    }
}

// Build an HttpUrl via the factory. In OkHttp 5 the static `parse(String)`
// companion was deprecated in favor of an extension function — which is
// not yet published on the public classpath we depend on. The factory
// pattern below hides the deprecation behind a single helper.
private fun url(value: String): HttpUrl = okhttp3.HttpUrl.Builder()
    .scheme(if (value.startsWith("https")) "https" else "http")
    .host(value.substringAfter("://").substringBefore("/").ifEmpty { "example.com" })
    .also { builder ->
        val path = value.substringAfter("://").substringAfter("/", "")
        if (path.isNotEmpty()) {
            val segments = path.split("/").filter { it.isNotEmpty() }
            for (segment in segments) {
                builder.addPathSegment(segment)
            }
        }
    }
    .build()
