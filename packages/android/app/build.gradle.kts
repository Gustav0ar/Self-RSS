plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.dagger.hilt.android")
    // KSP for Moshi adapter codegen. See the matching version in
    // packages/android/build.gradle.kts.
    id("com.google.devtools.ksp")
}

fun quotedBuildConfigValue(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val configuredReleaseApiBaseUrl = providers
    .gradleProperty("SELF_FEED_API_BASE_URL")
    .orElse(providers.environmentVariable("SELF_FEED_API_BASE_URL"))
    .orNull
    ?.trim()
    ?.takeIf { it.isNotBlank() }

val releaseTaskRequested = gradle.startParameter.taskNames.any {
    it.contains("Release", ignoreCase = true)
}

if (releaseTaskRequested) {
    if (configuredReleaseApiBaseUrl == null) {
        throw GradleException("Set SELF_FEED_API_BASE_URL to build a release APK/AAB.")
    }
    if (!configuredReleaseApiBaseUrl.startsWith("https://")) {
        throw GradleException("SELF_FEED_API_BASE_URL must use HTTPS for release builds.")
    }
}

val releaseApiBaseUrl = configuredReleaseApiBaseUrl?.let {
    if (it.endsWith("/")) it else "$it/"
}

android {
    namespace = "com.selffeed.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.selffeed.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        // Use localhost which maps to host machine in newer emulator engines, 
        // or fallback to 10.0.2.2 if needed.
        buildConfigField("String", "API_BASE_URL", "\"https://rss.gustavo.ca/api/v1/\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            buildConfigField(
                "String",
                "API_BASE_URL",
                quotedBuildConfigValue(releaseApiBaseUrl ?: "https://example.invalid/api/v1/"),
            )
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    sourceSets {
        getByName("debug").assets.setSrcDirs(listOf("$projectDir/schemas"))
        getByName("test").assets.setSrcDirs(listOf("$projectDir/schemas"))
        getByName("androidTest").assets.setSrcDirs(listOf("$projectDir/schemas"))
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    lint {
        disable += "MutableCollectionMutableState"
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.06.00")

    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.browser:browser:1.10.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("androidx.metrics:metrics-performance:1.0.0")
    implementation("androidx.navigation:navigation-compose:2.9.8")
    implementation("androidx.paging:paging-compose:3.5.0")
    implementation("androidx.paging:paging-runtime-ktx:3.5.0")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("com.google.android.material:material:1.14.0")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    implementation(platform("com.squareup.okhttp3:okhttp-bom:5.4.0"))
    implementation("com.squareup.okhttp3:okhttp")
    implementation("com.squareup.okhttp3:logging-interceptor")
    implementation("com.squareup.retrofit2:retrofit:3.0.0")
    implementation("com.squareup.retrofit2:converter-moshi:3.0.0")
    implementation("com.squareup.moshi:moshi:1.15.2")
    // Codegen-only — runs at build time, not packaged in the APK.
    ksp("com.squareup.moshi:moshi-kotlin-codegen:1.15.2")

    implementation("androidx.datastore:datastore-preferences:1.2.1")
    // EncryptedFile + MasterKey are still part of security-crypto, but
    // SessionStore now uses them only at the file level (not via
    // EncryptedSharedPreferences).
    implementation("androidx.security:security-crypto:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
    implementation("androidx.room:room-runtime:2.7.0")
    implementation("androidx.room:room-ktx:2.7.0")
    implementation("androidx.room:room-paging:2.7.0")
    ksp("androidx.room:room-compiler:2.7.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("com.google.dagger:hilt-android:2.59.2")
    ksp("com.google.dagger:hilt-compiler:2.59.2")
    implementation("androidx.hilt:hilt-work:1.3.0")
    ksp("androidx.hilt:hilt-compiler:1.3.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    testImplementation("io.mockk:mockk:1.14.11")
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation("androidx.test:core:1.7.0")
    testImplementation("androidx.test.ext:junit:1.3.0")
    testImplementation("androidx.test:runner:1.7.0")
    testImplementation("androidx.room:room-testing:2.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
