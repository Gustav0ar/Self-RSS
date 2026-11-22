package com.selffeed.android.network

import com.selffeed.android.BuildConfig
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * Guards against missing `@Serializable` annotations or Retrofit converter
 * mismatches across request DTOs. Verifies both direct `kotlinx.serialization`
 * round-trips and Retrofit `@Body` serializer resolution.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class RequestAdapterCoverageTest {
    private lateinit var json: Json

    @Before
    fun setup() {
        json = NetworkModule.provideJson()
    }

    @Test
    fun `json round-trips every request DTO`() {
        val cases: List<Pair<String, () -> Pair<KSerializer<Any>, Any>>> = listOf(
            @Suppress("UNCHECKED_CAST")
            ("LoginRequest" to { LoginRequest.serializer() as KSerializer<Any> to LoginRequest("reader@example.com", "password") }),
            @Suppress("UNCHECKED_CAST")
            ("RegisterRequest" to { RegisterRequest.serializer() as KSerializer<Any> to RegisterRequest("new@example.com", "password") }),
            @Suppress("UNCHECKED_CAST")
            ("CreateCategoryRequest" to { CreateCategoryRequest.serializer() as KSerializer<Any> to CreateCategoryRequest("Tech") }),
            @Suppress("UNCHECKED_CAST")
            ("UpdateCategoryRequest" to { UpdateCategoryRequest.serializer() as KSerializer<Any> to UpdateCategoryRequest(name = "Tech") }),
            @Suppress("UNCHECKED_CAST")
            ("CreateFeedRequest" to { CreateFeedRequest.serializer() as KSerializer<Any> to CreateFeedRequest("https://example.com/feed.xml", "c-1") }),
            @Suppress("UNCHECKED_CAST")
            ("UpdateFeedRequest" to { UpdateFeedRequest.serializer() as KSerializer<Any> to UpdateFeedRequest(title = "Feed") }),
            @Suppress("UNCHECKED_CAST")
            ("MarkReadRequest" to { MarkReadRequest.serializer() as KSerializer<Any> to MarkReadRequest(read = true) }),
            @Suppress("UNCHECKED_CAST")
            ("MarkAllReadRequest" to { MarkAllReadRequest.serializer() as KSerializer<Any> to MarkAllReadRequest(feedId = "f-1") }),
            @Suppress("UNCHECKED_CAST")
            ("UpdatePreferencesRequest" to { UpdatePreferencesRequest.serializer() as KSerializer<Any> to UpdatePreferencesRequest(theme = "dark") }),
            @Suppress("UNCHECKED_CAST")
            ("UpdateAppSettingsRequest" to { UpdateAppSettingsRequest.serializer() as KSerializer<Any> to UpdateAppSettingsRequest(registrationLocked = true) }),
        )
        for ((name, factory) in cases) {
            val (serializer, instance) = factory()
            val encoded = json.encodeToString(serializer, instance)
            assertTrue("empty JSON for $name", encoded.isNotEmpty())
            val decoded = json.decodeFromString(serializer, encoded)
            assertEquals("round-trip mismatch for $name", instance, decoded)
        }
    }

    @Test
    fun `retrofit can resolve all request DTO converters`() {
        val retrofit = Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(okhttp3.OkHttpClient())
            .addConverterFactory(json.asConverterFactory("application/json; charset=UTF8".toMediaType()))
            .build()
        val api = retrofit.create(RssApi::class.java)

        val apiMethods = api.javaClass.declaredMethods
        for (method in apiMethods) {
            val bodyParams = method.parameterAnnotations
                .mapIndexedNotNull { index, annotations ->
                    if (annotations.any { it.annotationClass.qualifiedName == "retrofit2.http.Body" }) index else null
                }
            for (paramIndex in bodyParams) {
                val paramType = method.genericParameterTypes[paramIndex]
                val serializer = json.serializersModule.serializer(paramType)
                assertNotNull(
                    "Missing kotlinx.serialization serializer for $paramType (method ${method.name} #$paramIndex)",
                    serializer,
                )
            }
        }
    }

    @Test
    fun `json round-trips a typical login`() = runBlocking {
        val original = LoginRequest("reader@example.com", "hunter2")
        val encoded = json.encodeToString(LoginRequest.serializer(), original)
        val decoded = json.decodeFromString(LoginRequest.serializer(), encoded)
        assertEquals(original.email, decoded.email)
        assertEquals(original.password, decoded.password)
    }

    @Test
    fun `generated serializer decodes preferences when optional fields are absent`() {
        val decoded = json.decodeFromString(
            UserPreferences.serializer(),
            """
            {
              "theme": "system",
              "fontFamily": "sans",
              "textSize": 100,
              "density": "comfortable",
              "defaultSort": "newest",
              "hideRead": false,
              "keyboardShortcutsEnabled": true,
              "autoMarkReadMode": "manual"
            }
            """.trimIndent(),
        )

        assertEquals("system", decoded.theme)
        assertNull(decoded.userId)
        assertNull(decoded.accentColor)
        assertNull(decoded.createdAt)
        assertNull(decoded.updatedAt)
    }
}
