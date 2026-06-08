package com.selffeed.android.network

import com.selffeed.android.BuildConfig
import com.selffeed.android.data.SessionStore
import com.squareup.moshi.FromJson
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.JsonReader
import com.squareup.moshi.Moshi
import com.squareup.moshi.ToJson
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.Authenticator
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

            val refreshedToken = refreshAccessToken(response.request.url) ?: return null
            sessionStore.setAccessToken(refreshedToken)
            return response.request.newBuilder()
                .header("Authorization", "Bearer $refreshedToken")
                .build()
        }
    }

    private fun refreshAccessToken(url: HttpUrl): String? {
        val baseUrl = url.newBuilder().encodedPath("/api/v1/auth/refresh").build()
        val request = Request.Builder()
            .url(baseUrl)
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()

        val client = OkHttpClient.Builder()
            .cookieJar(PersistedRefreshCookieJar(sessionStore))
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body?.string() ?: return null
            val parsed = responseAdapter.fromJson(body) ?: return null
            return parsed.data.tokens.accessToken
        }
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
}

object NetworkModule {
    fun provideMoshi(): Moshi = Moshi.Builder()
        .add(FlexibleBooleanAdapter())
        .add(KotlinJsonAdapterFactory())
        .build()

    fun provideOkHttpClient(
        sessionStore: SessionStore,
        moshi: Moshi,
    ): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
        }

        return OkHttpClient.Builder()
            .cookieJar(PersistedRefreshCookieJar(sessionStore))
            .addInterceptor { chain ->
                val original = chain.request()
                val accessToken = sessionStore.getAccessToken()
                val requestBuilder = original.newBuilder()

                if (!accessToken.isNullOrBlank()) {
                    requestBuilder.header("Authorization", "Bearer $accessToken")
                }

                if (original.header("Content-Type") == null) {
                    requestBuilder.header("Content-Type", "application/json")
                }

                chain.proceed(requestBuilder.build())
            }
            .authenticator(TokenAuthenticator(sessionStore, moshi))
            .addInterceptor(logging)
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
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
            JsonReader.Token.STRING -> reader.nextString().toBoolean()
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
