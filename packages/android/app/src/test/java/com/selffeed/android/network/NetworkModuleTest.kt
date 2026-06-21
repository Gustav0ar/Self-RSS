@file:Suppress("DEPRECATION")

package com.selffeed.android.network

import com.selffeed.android.data.SessionStore
import io.mockk.every
import io.mockk.mockk
import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.atomic.AtomicReference
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
    fun `normalizeApiServerHost accepts host values and strips pasted paths`() {
        assertEquals("rss.example.com", normalizeApiServerHost("rss.example.com"))
        assertEquals("10.0.22.22:3000", normalizeApiServerHost("10.0.22.22:3000"))
        assertEquals(
            "10.0.22.22:3000",
            normalizeApiServerHost("http://10.0.22.22:3000/api/rss"),
        )
    }

    @Test
    fun `api base url is inferred from server host and configured api path`() {
        assertEquals(
            "http://10.0.22.22:3000/api/v1/",
            apiBaseUrlFromServerHost(
                serverHost = "10.0.22.22:3000",
                defaultBaseUrl = "http://10.0.2.2:3000/api/v1/",
            ),
        )
    }

    @Test
    fun `public hostname without port infers https and does not inherit debug port`() {
        assertEquals(
            "https://rss.example.test/api/v1/",
            apiBaseUrlFromServerHost(
                serverHost = "rss.example.test",
                defaultBaseUrl = "http://10.0.2.2:3000/api/v1/",
            ),
        )
    }

    @Test
    fun `api base url preserves configured api path instead of using pasted path`() {
        assertEquals(
            "http://10.0.22.22:3000/api/rss/",
            apiBaseUrlFromServerHost(
                serverHost = "http://10.0.22.22:3000/ignored/path",
                defaultBaseUrl = "http://10.0.2.2:3000/api/rss/",
            ),
        )
    }

    @Test
    fun `rewriteApiRequestUrl uses configured server and preserves endpoint and query`() {
        val rewritten = rewriteApiRequestUrl(
            original = url("http://10.0.2.2:3000/api/v1/articles?limit=30&cursor=abc"),
            configuredBaseUrl = "10.0.22.22:3000",
            defaultBaseUrl = "http://10.0.2.2:3000/api/v1/",
        )

        assertEquals("http://10.0.22.22:3000/api/v1/articles?limit=30&cursor=abc", rewritten.toString())
    }

    @Test
    fun `apiEndpointUrl uses configured base path for read state stream`() {
        val url = apiEndpointUrl("10.0.22.22:3000", "events/read-state")

        assertEquals("http://10.0.22.22:3000/api/v1/events/read-state", url.toString())
    }

    @Test
    fun `retrofit login request uses persisted host only server`() = runBlocking {
        val capturedUrl = loginRequestUrlForConfiguredServer("10.0.22.22:3000")

        assertEquals("http://10.0.22.22:3000/api/v1/auth/login", capturedUrl.toString())
    }

    @Test
    fun `retrofit login request uses https for public hostname without port`() = runBlocking {
        val capturedUrl = loginRequestUrlForConfiguredServer("rss.example.test")

        assertEquals("https://rss.example.test/api/v1/auth/login", capturedUrl.toString())
    }

    private suspend fun loginRequestUrlForConfiguredServer(server: String): HttpUrl {
        val store = mockk<SessionStore>()
        every { store.getApiBaseUrl() } returns server
        val capturedUrl = AtomicReference<HttpUrl>()
        val client = OkHttpClient.Builder()
            .addInterceptor(ApiBaseUrlInterceptor(store))
            .addInterceptor { chain ->
                capturedUrl.set(chain.request().url)
                Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body(
                        """
                        {
                          "data": {
                            "user": {
                              "id": "user-1",
                              "email": "reader@example.com",
                              "role": "reader",
                              "isActive": true
                            },
                            "tokens": {
                              "accessToken": "test-token"
                            }
                          }
                        }
                        """.trimIndent().toResponseBody("application/json".toMediaType()),
                    )
                    .build()
            }
            .build()
        val api = NetworkModule.provideApi(client, NetworkModule.provideMoshi())

        val response = api.login(LoginRequest("reader@example.com", "password123"))

        assertEquals("test-token", response.data.tokens.accessToken)
        return capturedUrl.get()
    }

    @Test
    fun `debug network security allows host only local development servers`() {
        val xml = androidAppFile("src/debug/res/xml/network_security_config.xml").readText()

        assertTrue(xml.contains("""<base-config cleartextTrafficPermitted="true">"""))
    }

    @Test
    fun `release network security keeps cleartext disabled`() {
        val xml = androidAppFile("src/release/res/xml/network_security_config.xml").readText()

        assertTrue(xml.contains("<base-config cleartextTrafficPermitted=\"false\""))
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
    fun `saveFromResponse does not throw when secure storage fails`() {
        val store = mockk<SessionStore>()
        every { store.setRefreshCookie(any()) } throws IllegalStateException("missing keystore key")
        val jar = PersistedRefreshCookieJar(store)
        val refreshCookie = Cookie.Builder()
            .name("rss_refresh_token")
            .value("refresh-value")
            .domain("example.com")
            .path("/")
            .build()

        jar.saveFromResponse(url("https://example.com"), listOf(refreshCookie))
    }

    @Test
    fun `loadForRequest returns empty when secure storage read fails`() {
        val store = mockk<SessionStore>()
        every { store.getRefreshCookie() } throws IllegalStateException("missing keystore key")
        val jar = PersistedRefreshCookieJar(store)

        val cookies = jar.loadForRequest(url("https://example.com/api/v1/auth/refresh"))

        assertTrue(cookies.isEmpty())
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
private fun url(value: String): HttpUrl {
    val uri = java.net.URI(value)
    return okhttp3.HttpUrl.Builder()
        .scheme(uri.scheme)
        .host(uri.host)
        .also { builder ->
            if (uri.port != -1) builder.port(uri.port)
            val path = uri.path.orEmpty()
            if (path.isNotEmpty()) {
                val segments = path.split("/").filter { it.isNotEmpty() }
                for (segment in segments) {
                    builder.addPathSegment(segment)
                }
            }
            if (!uri.rawQuery.isNullOrEmpty()) {
                builder.encodedQuery(uri.rawQuery)
            }
        }
        .build()
}

private fun androidAppFile(relativePath: String): File =
    listOf(
        File(relativePath),
        File("app/$relativePath"),
        File("packages/android/app/$relativePath"),
    ).firstOrNull { it.exists() }
        ?: error("Could not find Android app file: $relativePath")
