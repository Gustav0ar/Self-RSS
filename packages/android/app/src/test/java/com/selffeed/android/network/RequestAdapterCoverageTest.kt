package com.selffeed.android.network

import com.selffeed.android.BuildConfig
import com.selffeed.android.data.RssRepository
import com.squareup.moshi.Moshi
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

/**
 * Guards against the "Unable to create @Body converter for class …"
 * runtime failure. The Moshi setup uses `moshi-kotlin-codegen` (KSP)
 * to generate a `*JsonAdapter` for every `@JsonClass(generateAdapter
 * = true)` class; this test enumerates every request DTO and verifies
 * that the production Moshi can both serialize it and the
 * corresponding Retrofit method can be looked up.
 *
 * Regression: removing `KotlinJsonAdapterFactory()` from
 * [NetworkModule.provideMoshi] without first annotating the request
 * DTOs in `ApiRequests.kt` produced a runtime "Unable to create
 * @Body converter" failure on the login screen. This test catches
 * that class of bug at unit-test time.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class RequestAdapterCoverageTest {
    private lateinit var moshi: Moshi

    @Before
    fun setup() {
        moshi = NetworkModule.provideMoshi()
    }

    @Test
    fun `moshi round-trips every request DTO`() {
        val pairs: List<Pair<String, () -> Any>> = listOf(
            "LoginRequest" to { LoginRequest("reader@example.com", "password") },
            "RegisterRequest" to { RegisterRequest("new@example.com", "password") },
            "CreateCategoryRequest" to { CreateCategoryRequest("Tech") },
            "UpdateCategoryRequest" to { UpdateCategoryRequest(name = "Tech") },
            "CreateFeedRequest" to { CreateFeedRequest("https://example.com/feed.xml", "c-1") },
            "UpdateFeedRequest" to { UpdateFeedRequest(title = "Feed") },
            "MarkReadRequest" to { MarkReadRequest(read = true) },
            "MarkAllReadRequest" to { MarkAllReadRequest(feedId = "f-1") },
            "UpdatePreferencesRequest" to { UpdatePreferencesRequest(theme = "dark") },
            "UpdateAppSettingsRequest" to { UpdateAppSettingsRequest(registrationLocked = true) },
        )
        for ((name, factory) in pairs) {
            val instance = factory()
            val adapter = moshi.adapter(instance.javaClass)
            assertNotNull("missing adapter for $name", adapter)
            val json = adapter.toJson(instance)
            assertTrue("empty JSON for $name", json.isNotEmpty())
            // Round-trip decode
            val decoded = adapter.fromJson(json)
            assertNotNull("failed to decode $name: $json", decoded)
        }
    }

    @Test
    fun `retrofit can resolve all request DTO converters`() {
        val retrofit = Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(okhttp3.OkHttpClient())
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
        val api = retrofit.create(RssApi::class.java)

        // For each Retrofit method, ask Retrofit for its parameter
        // types and verify the Moshi converter can resolve every
        // @Body-annotated type. This is the exact lookup Retrofit
        // does at runtime — if a request DTO is missing an adapter,
        // calling `api.javaClass.methods` won't fail, but the next
        // attempt to use the method will throw.
        val apiMethods = api.javaClass.declaredMethods
        for (method in apiMethods) {
            val bodyParams = method.parameterAnnotations
                .mapIndexedNotNull { index, annotations ->
                    if (annotations.any { it.annotationClass.qualifiedName == "retrofit2.http.Body" }) index else null
                }
            for (paramIndex in bodyParams) {
                val paramType = method.parameterTypes[paramIndex]
                val adapter = moshi.adapter<Any>(paramType)
                assertNotNull(
                    "Missing Moshi adapter for ${paramType.simpleName} " +
                        "(method ${method.name} #${paramIndex})",
                    adapter,
                )
            }
        }
    }

    @Test
    fun `moshi round-trips a typical login`() = runBlocking {
        val adapter = moshi.adapter(LoginRequest::class.java)
        val original = LoginRequest("reader@example.com", "hunter2")
        val json = adapter.toJson(original)
        val decoded = adapter.fromJson(json)!!
        assertEquals(original.email, decoded.email)
        assertEquals(original.password, decoded.password)
    }
}
