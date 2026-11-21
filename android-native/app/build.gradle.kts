plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.bookhad.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.bookhad.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "2.0.0-zeroshot"

        // Target ARM64-v8a (Helio G99 Cortex-A76/A55 64-bit) to keep APK size minimal
        ndk {
            abiFilters += listOf("arm64-v8a")
        }

        externalNativeBuild {
            cmake {
                cppFlags += listOf("-O3", "-std=c++17", "-ffast-math")
                arguments += listOf("-DANDROID_STL=c++_shared")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    // Keep .onnx models uncompressed in APK so extraction & mmap work with zero overhead
    androidResources {
        noCompress += listOf("onnx", "ort", "emb", "bin")
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
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
    // ONNX Runtime Mobile (CPU + XNNPACK ARM64 NEON, INT8 quantized neural networks)
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.19.2")

    // Kotlin Coroutines for Dispatchers.Default / Dispatchers.IO streaming pipeline
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // AndroidX Edge-to-Edge & Core UI
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
