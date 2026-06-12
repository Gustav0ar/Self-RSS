package com.selffeed.android.network

import android.content.Context
import com.selffeed.android.BuildConfig
import com.selffeed.android.data.SessionStore
import com.squareup.moshi.FromJson
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.JsonReader
import com.squareup.moshi.Moshi
import com.squareup.moshi.ToJson
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.Authenticator
import okhttp3.Cache
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.io.File
import java.util.concurrent.TimeUnit

class PersistedRefreshCookieJar(
    private val sessionStore: SessionStore,
) : CookieJar {
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val refresh = cookies.firstOrNull { it.name == REFRESH_COOKIE_NAME }
        if (refresh != null) {
            sessionStore.setRefreshCookie(refresh.toString())
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val rawCookie = sessionStore.getRefreshCookie() ?: return emptyList()
        val cookie = Cookie.parse(url, rawCookie) ?: return emptyList()
        return if (cookie.expiresAt < System.currentTimeMillis()) {
            sessionStore.setRefreshCookie(null)
            emptyList()
        } else {
            listOf(cookie)
        }
    }

    companion object {
        private const val REFRESH_COOKIE_NAME = "rss_refresh_token"
    }
}

class TokenAuthenticator(
    private val sessionStore: SessionStore,
    private val moshi: Moshi,
) : Authenticator {
    private val lock = Any()
    private val responseAdapter: JsonAdapter<ApiEnvelope<RefreshData>> = moshi.adapter(
        Types.apiEnvelopeRefreshType,
    )

    override fun authenticate(route: okhttp3.Route?, response: okhttp3.Response): Request? {
        if (responseCount(response) >= 2) return null
        if (response.request.url.encodedPath.endsWith("/auth/refresh")) return null

        synchronized(lock) {
            val currentToken = sessionStore.getAccessToken()
            val requestToken = response.request.header("Authorization")
                ?.removePrefix("Bearer ")
            if (!currentToken.isNullOrBlank() && currentToken != requestToken) {
                return response.request.newBuilder()
                    .header("Authorization", "Bearer $currentToken")
                    .build()
            }

            val refreshedToken = refreshAccessToken(response.request.url) ?: run {
                // Refresh failed (e.g. revoked/expired refresh cookie). Clear the local
                // access token so the next call goes unauthenticated and the UI can
                // route to the login screen.
                sessionStore.setAccessToken(null)
                return null
            }
            sessionStore.setAccessToken(refreshedToken)
            return response.request.newBuilder()
                .header("Authorization", "Bearer $refreshedToken")
                .build()
        }
    }

    /**
     * Performs a token refresh using a fresh one-shot OkHttpClient that shares
     * the cookie jar (so the refresh cookie is attached) but no authenticator
     * and no other application interceptors — to avoid recursion through
     * [authenticate] and to keep the request path minimal.
     */
    private fun refreshAccessToken(url: HttpUrl): String? {
        val baseUrl = url.newBuilder().encodedPath("/api/v1/auth/refresh").build()
        val request = Request.Builder()
            .url(baseUrl)
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()

        val client = OkHttpClient.Builder()
            .cookieJar(PersistedRefreshCookieJar(sessionStore))
            .connectTimeout(REFRESH_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(REFRESH_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(REFRESH_WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(REFRESH_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .build()

        return runCatching {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val body = response.body?.string() ?: return@use null
                val parsed = responseAdapter.fromJson(body) ?: return@use null
                parsed.data.tokens.accessToken
            }
        }.getOrNull()
    }

    private fun responseCount(response: okhttp3.Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }

    companion object {
        private const val REFRESH_CONNECT_TIMEOUT_SECONDS = 5L
        private const val REFRESH_READ_TIMEOUT_SECONDS = 10L
        private const val REFRESH_WRITE_TIMEOUT_SECONDS = 10L
        private const val REFRESH_CALL_TIMEOUT_SECONDS = 15L
    }
}

object NetworkModule {
    fun provideMoshi(): Moshi = Moshi.Builder()
        .add(FlexibleBooleanAdapter())
        // KotlinJsonAdapterFactory (reflection) is included as a fallback for
        // DTOs that haven't been pre-compiled to a generated adapter. The
        // project's DTOs all carry @JsonClass(generateAdapter = true), so
        // the generated adapter is found first; the reflective factory only
        // serves as a safety net during early development.
        .add(KotlinJsonAdapterFactory())
        .build()

    fun provideOkHttpClient(
        context: Context,
        sessionStore: SessionStore,
        moshi: Moshi,
    ): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        }

        val cache = Cache(
            File(context.cacheDir, "http-cache"),
            HTTP_CACHE_SIZE_BYTES,
        )

        val authenticator = TokenAuthenticator(sessionStore, moshi)

        return OkHttpClient.Builder()
            .cookieJar(PersistedRefreshCookieJar(sessionStore))
            .addInterceptor { chain ->
                val request = chain.request()
                val accessToken = sessionStore.getAccessToken()
                val requestBuilder = request.newBuilder()

                if (!accessToken.isNullOrBlank()) {
                    requestBuilder.header("Authorization", "Bearer $accessToken")
                }

                requestBuilder.header("X-Self-Feed-Client-Id", sessionStore.getClientId())

                if (request.body != null && request.header("Content-Type") == null) {
                    requestBuilder.header("Content-Type", "application/json")
                }

                chain.proceed(requestBuilder.build())
            }
            .authenticator(authenticator)
            .addInterceptor(logging)
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .cache(cache)
            .pingInterval(PING_INTERVAL_SECONDS, TimeUnit.SECONDS)
            .build()
    }

    fun provideApi(client: OkHttpClient, moshi: Moshi): RssApi {
        val retrofit = Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()

        return retrofit.create(RssApi::class.java)
    }

    private const val HTTP_CACHE_SIZE_BYTES = 10L * 1024 * 1024
    private const val CONNECT_TIMEOUT_SECONDS = 10L
    private const val READ_TIMEOUT_SECONDS = 15L
    private const val WRITE_TIMEOUT_SECONDS = 15L
    private const val CALL_TIMEOUT_SECONDS = 30L
    private const val PING_INTERVAL_SECONDS = 30L
}

private object Types {
    val apiEnvelopeRefreshType = com.squareup.moshi.Types.newParameterizedType(
        ApiEnvelope::class.java,
        RefreshData::class.java,
    )
}

class FlexibleBooleanAdapter {
    @FromJson
    fun fromJson(reader: JsonReader): Boolean {
        return when (reader.peek()) {
            JsonReader.Token.BOOLEAN -> reader.nextBoolean()
            JsonReader.Token.NUMBER -> reader.nextInt() != 0
            JsonReader.Token.STRING -> {
                val s = reader.nextString().trim()
                if (s.isEmpty()) false
                else when (s.lowercase()) {
                    "true", "1", "yes", "y" -> true
                    else -> false
                }
            }
            JsonReader.Token.NULL -> {
                reader.nextNull<Unit>()
                false
            }
            else -> {
                reader.skipValue()
                false
            }
        }
    }

    @ToJson
    fun toJson(value: Boolean): Boolean = value
}
