plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val buildNumber = (System.getenv("BUILD_NUMBER") ?: "1").toInt()

android {
    namespace = "com.likhon.pad"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.likhon.pad"
        minSdk = 26
        targetSdk = 34
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    // একই চাবি দিয়ে সাইন করা হয়, তাই নতুন সংস্করণ পুরোনোটার ওপর সরাসরি ইনস্টল হবে
    signingConfigs {
        create("likhon") {
            storeFile = file("likhon.keystore")
            storePassword = "likhon-pad"
            keyAlias = "likhon"
            keyPassword = "likhon-pad"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("likhon")
        }
        debug {
            signingConfig = signingConfigs.getByName("likhon")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
