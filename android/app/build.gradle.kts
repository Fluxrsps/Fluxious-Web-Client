plugins {
    id("com.android.application")
}

android {
    namespace = "com.fluxious.play"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.fluxious.play"

        // The WebView's floor, not the wrapper's: from Android 5.0 the system WebView is a
        // separately updatable Play package, while on 4.4 it is frozen at Chromium 33.
        minSdk = 21
        targetSdk = 34

        versionCode = 1
        versionName = "1.0"

        buildConfigField(
            "String",
            "START_URL",
            "\"${project.findProperty("flux.startUrl") ?: "https://play.fluxious-rsps.com"}\"",
        )
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
