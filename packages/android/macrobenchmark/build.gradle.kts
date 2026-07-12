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
    implementation("androidx.benchmark:benchmark-macro-junit4:1.5.0-alpha07")
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
    implementation("androidx.test.ext:junit:1.3.0")
    implementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
