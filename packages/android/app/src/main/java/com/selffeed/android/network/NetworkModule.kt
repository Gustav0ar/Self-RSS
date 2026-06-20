package com.selffeed.android.network

import android.content.Context
import android.util.Log
import com.selffeed.android.BuildConfig
import com.selffeed.android.data.SessionStore
import com.squareup.moshi.FromJson
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.JsonReader
import com.squareup.moshi.Moshi
import com.squareup.moshi.ToJson
import okhttp3.Authenticator
import okhttp3.Cache
import okhttp3.CertificatePinner
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
import javax.net.ssl.SSLPeerUnverifiedException
import java.util.concurrent.TimeUnit

class PersistedRefreshCookieJar(
    private val sessionStore: SessionStore,
) : CookieJar {
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val refresh = cookies.firstOrNull { it.name == REFRESH_COOKIE_NAME }
        if (refresh != null) {
            runCatching { sessionStore.setRefreshCookie(refresh.toString()) }
                .onFailure { logCookieJarError("Failed to persist refresh cookie", it) }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val rawCookie = runCatching { sessionStore.getRefreshCookie() }
            .onFailure { logCookieJarError("Failed to read refresh cookie", it) }
            .getOrNull()
            ?: return emptyList()
        val cookie = Cookie.parse(url, rawCookie) ?: return emptyList()
        return if (cookie.expiresAt < System.currentTimeMillis()) {
            runCatching { sessionStore.setRefreshCookie(null) }
                .onFailure { logCookieJarError("Failed to clear expired refresh cookie", it) }
            emptyList()
        } else {
            listOf(cookie)
        }
    }

    companion object {
        private const val TAG = "PersistedRefreshCookieJar"
        private const val REFRESH_COOKIE_NAME = "rss_refresh_token"

        private fun logCookieJarError(message: String, throwable: Throwable) {
            runCatching { Log.e(TAG, message, throwable) }
        }
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
            .apply {
                certificatePinner?.let { pinner ->
                    certificatePinner(pinner)
                }
            }
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

        /**
         * Builds a [CertificatePinner] from BuildConfig pins if configured.
         * Returns null in debug builds or if no pins are configured.
         *
         * Pins are configured as pipe-separated SHA-256 hashes with the "sha256/" prefix:
         * "sha256/AAA...|sha256/BBB..."
         *
         * Certificate pinning prevents MITM attacks by verifying the server's certificate
         * matches one of the pinned public key hashes. If pinning fails, the connection
         * is rejected with a clear security error.
         *
         * For rotation: always keep at least one backup pin. Deploy new cert with its
         * pin as backup first, then promote to primary after full rollout.
         */
        private fun buildCertificatePinner(): CertificatePinner? {
            if (BuildConfig.DEBUG) {
                // Disable pinning in debug to allow local development with self-signed certs
                return null
            }

            val primaryPins = BuildConfig.CERTIFICATE_PINS
            val backupPins = BuildConfig.BACKUP_CERTIFICATE_PINS

            if (primaryPins.isBlank() && backupPins.isBlank()) {
                // No pins configured - log a warning in release builds
                Log.w(TAG, "Certificate pinning not configured. Set CERTIFICATE_PINS in build.gradle.kts for production.")
                return null
            }

            if (primaryPins.isBlank()) {
                Log.w(TAG, "Primary certificate pins not configured. Set CERTIFICATE_PINS in build.gradle.kts.")
                return null
            }

            return CertificatePinner.Builder()
                .apply {
                    // Primary domain pinning
                    add(
                        PRODUCTION_API_HOSTNAME,
                        *primaryPins.split("|").filter { it.isNotBlank() }.toTypedArray(),
                    )

                    // Backup pins for certificate rotation
                    if (backupPins.isNotBlank()) {
                        val backupList = backupPins.split("|").filter { it.isNotBlank() }
                        add(PRODUCTION_API_HOSTNAME, *backupList.toTypedArray())
                    }
                }
                .build()
        }

        private const val TAG = "TokenAuthenticator"
        private const val PRODUCTION_API_HOSTNAME = "api.selffeed.com"
        val certificatePinner: CertificatePinner? by lazy { buildCertificatePinner() }

        fun logCertificatePinningFailure(e: SSLPeerUnverifiedException) {
            // Log security-critical event with details for forensic analysis.
            // Do NOT log sensitive data like certificate contents - only the hostname.
            Log.e(TAG, "Certificate pinning failure: ${e.message}", e)
        }
    }
}

object NetworkModule {
    /**
     * Moshi instance with no reflective [com.squareup.moshi.kotlin.reflect
     * .KotlinJsonAdapterFactory]. Every DTO in the project is annotated
     * `@JsonClass(generateAdapter = true)`, and the
     * `moshi-kotlin-codegen` KSP processor generates a static
     * `*JsonAdapter` companion for each at compile time. The generated
     * adapter is located reflectively by Moshi's built-in lookup; no
     * runtime reflection is needed, which means faster cold start and
     * fewer dependencies at runtime.
     *
     * The custom [FlexibleBooleanAdapter] still handles the API's mixed
     * boolean encodings (0/1, true/false, "1"/"0", "yes"/"no").
     */
    fun provideMoshi(): Moshi = Moshi.Builder()
        .add(FlexibleBooleanAdapter())
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
            .apply {
                TokenAuthenticator.certificatePinner?.let { pinner ->
                    certificatePinner(pinner)
                }
            }
            .addInterceptor { chain ->
                try {
                    chain.proceed(chain.request())
                } catch (e: SSLPeerUnverifiedException) {
                    TokenAuthenticator.logCertificatePinningFailure(e)
                    throw e
                }
            }
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
    private const val TAG = "NetworkModule"
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
