# Navigation 3 restores NavKeys through their runtime class names and generated
# Kotlin serialization adapters. Keep this tiny route set stable across a
# process-death restore and an app update.
-keep class com.selffeed.android.ui.ArticleListDestination { *; }
-keep class com.selffeed.android.ui.ArticleDetailDestination { *; }

# Moshi discovers KSP-generated adapters from the model's runtime class name.
# AGP does not currently merge the keep rules emitted into KSP's generated
# resource directory, so R8 otherwise removes those adapters and the minified
# app crashes during dependency injection on startup.
-keepnames @com.squareup.moshi.JsonClass class com.selffeed.android.network.**
-keep class com.selffeed.android.network.**JsonAdapter { *; }

# Moshi's generated adapters use reflection to call Kotlin's synthetic
# default-argument constructors when an optional JSON field is absent. Those
# constructor calls are invisible to R8. KSP emits exact keep rules under its
# generated META-INF/proguard directory, but AGP does not merge that directory
# for this app module, so preserve the equivalent members here.
-keepclassmembers @com.squareup.moshi.JsonClass class com.selffeed.android.network.** {
    public synthetic <init>(...);
}
