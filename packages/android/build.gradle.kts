plugins {
    id("com.android.application") version "9.3.0" apply false
    id("com.android.test") version "9.3.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.2.10" apply false
    id("com.google.dagger.hilt.android") version "2.59.2" apply false
    // KSP for Moshi codegen. Tracks Kotlin 2.2.x.
    id("com.google.devtools.ksp") version "2.3.2" apply false
    // 1.5 adds support for the AGP 9.x line used by this app.
    id("androidx.baselineprofile") version "1.5.0-alpha07" apply false
}
