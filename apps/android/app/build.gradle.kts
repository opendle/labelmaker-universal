import java.math.BigDecimal
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val versionManifestFile = rootProject.layout.projectDirectory.file("../../distribution/version.json").asFile
val versionManifest = JsonSlurper().parse(versionManifestFile) as Map<*, *>
require(versionManifest["schemaVersion"] == 1) { "The release version manifest schema is not supported." }
val productVersion = requireNotNull(versionManifest["productVersion"] as? String) {
    "The product version is missing."
}
require(productVersion.matches(Regex("^[0-9]+\\.[0-9]+\\.[0-9]+$"))) {
    "The product version must use major.minor.patch format."
}
val buildNumbers = versionManifest["buildNumbers"] as? Map<*, *>
val androidBuildNumberValue = requireNotNull(buildNumbers?.get("android") as? Number) {
    "The Android build number is missing."
}
val androidBuildNumberLong = requireNotNull(
    runCatching {
        BigDecimal(androidBuildNumberValue.toString()).longValueExact()
    }.getOrNull(),
) {
    "The Android build number must be an integer from 1 through 2100000000."
}
require(androidBuildNumberLong in 1L..2_100_000_000L) {
    "The Android build number must be an integer from 1 through 2100000000."
}
val androidBuildNumber = androidBuildNumberLong.toInt()

data class SigningMaterial(
    val storePath: String,
    val keyAlias: String,
    val storePassword: String,
    val keyPassword: String,
)

fun signingMaterial(prefix: String): SigningMaterial? {
    val values = listOf(
        System.getenv("${prefix}_KEYSTORE"),
        System.getenv("${prefix}_KEY_ALIAS"),
        System.getenv("${prefix}_KEYSTORE_PASSWORD"),
        System.getenv("${prefix}_KEY_PASSWORD"),
    )
    require(values.all { it.isNullOrBlank() } || values.all { !it.isNullOrBlank() }) {
        "Set all signing values for $prefix, or set none of them."
    }
    if (values.all { it.isNullOrBlank() }) return null
    return SigningMaterial(
        storePath = values[0]!!,
        keyAlias = values[1]!!,
        storePassword = values[2]!!,
        keyPassword = values[3]!!,
    )
}

val appSigning = signingMaterial("LABELMAKER_ANDROID_APP")
val uploadSigning = signingMaterial("LABELMAKER_ANDROID_UPLOAD")
val requestedTasks = gradle.startParameter.taskNames.map { it.substringAfterLast(':') }
if (requestedTasks.any { it == "verifiedBundlePlayRelease" }) {
    require(uploadSigning != null) {
        "The Play release needs all LABELMAKER_ANDROID_UPLOAD_* signing values."
    }
}
if (requestedTasks.any { it == "verifiedAssembleDirectRelease" }) {
    require(appSigning != null) {
        "The direct release needs all LABELMAKER_ANDROID_APP_* signing values."
    }
}

android {
    namespace = "com.opendle.labelmaker"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.opendle.labelmaker"
        minSdk = 31
        targetSdk = 36
        versionCode = androidBuildNumber
        versionName = productVersion

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    signingConfigs {
        if (appSigning != null) {
            create("appRelease") {
                storeFile = file(appSigning.storePath)
                storePassword = appSigning.storePassword
                keyAlias = appSigning.keyAlias
                keyPassword = appSigning.keyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
        if (uploadSigning != null) {
            create("uploadRelease") {
                storeFile = file(uploadSigning.storePath)
                storePassword = uploadSigning.storePassword
                keyAlias = uploadSigning.keyAlias
                keyPassword = uploadSigning.keyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("play") {
            dimension = "distribution"
            signingConfig = signingConfigs.findByName("uploadRelease")
        }
        create("direct") {
            dimension = "distribution"
            signingConfig = signingConfigs.findByName("appRelease")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
            allWarningsAsErrors.set(true)
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/AL2.0",
            "META-INF/LGPL2.1",
        )
    }
}

val mobileWebDirectory = rootProject.layout.projectDirectory.dir("../mobile-web")
val generatedWebAssets = layout.buildDirectory.dir("generated/mobileWebAssets")

val buildMobileWeb by tasks.registering(Exec::class) {
    workingDir(rootProject.layout.projectDirectory.dir("../..").asFile)
    commandLine("npm", "run", "build", "--workspace", "@labelmaker/mobile-web")
    inputs.dir(mobileWebDirectory.dir("src"))
    inputs.file(mobileWebDirectory.file("index.html"))
    inputs.file(mobileWebDirectory.file("package.json"))
    outputs.dir(mobileWebDirectory.dir("dist"))
    // The bundle imports source from shared workspace packages. Always rebuild
    // it so a native package cannot contain stale shared code.
    outputs.upToDateWhen { false }
}

val syncMobileWebAssets by tasks.registering(Sync::class) {
    dependsOn(buildMobileWeb)
    from(mobileWebDirectory.dir("dist"))
    into(generatedWebAssets.map { it.dir("webapp") })
}

android.sourceSets["main"].assets.srcDir(generatedWebAssets)
tasks.named("preBuild").configure { dependsOn(syncMobileWebAssets) }

tasks.register("verifiedBundlePlayRelease") {
    group = "distribution"
    description = "Builds the signed Play Store application bundle."
    dependsOn("bundlePlayRelease")
}

tasks.register("verifiedAssembleDirectRelease") {
    group = "distribution"
    description = "Builds the signed universal direct-install APK."
    dependsOn("assembleDirectRelease")
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.12.2")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.webkit:webkit:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("androidx.test:core-ktx:1.7.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")

    androidTestImplementation("androidx.test:core-ktx:1.7.0")
    androidTestImplementation("androidx.test.ext:junit-ktx:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}
