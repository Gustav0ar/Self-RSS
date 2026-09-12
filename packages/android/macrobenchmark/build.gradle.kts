plugins {
    id("com.android.test")
    id("androidx.baselineprofile")
}

android {
    namespace = "com.selffeed.android.macrobenchmark"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
        targetSdk = 35
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "TARGET_PACKAGE", "\"com.selffeed.android\"")
    }

    buildFeatures.buildConfig = true
    buildTypes {
        create("performanceTest") {
            isDebuggable = true
            matchingFallbacks += listOf("release")
            buildConfigField("String", "TARGET_PACKAGE", "\"com.selffeed.android.performancetest\"")
        }
    }

    targetProjectPath = ":app"

    testOptions.managedDevices.localDevices {
        create("pixel6Api31") {
            device = "Pixel 6"
            apiLevel = 31
            // AOSP images provide the rooted environment required for
            // reproducible Baseline Profile generation in CI.
            systemImageSource = "aosp"
        }
    }
}

baselineProfile {
    managedDevices += "pixel6Api31"
    useConnectedDevices = false
}

dependencies {
    implementation("com.squareup.okhttp3:mockwebserver3:5.4.0")
    implementation("androidx.benchmark:benchmark-macro-junit4:1.5.0-alpha07")
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
    implementation("androidx.test.ext:junit:1.3.0")
    implementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
