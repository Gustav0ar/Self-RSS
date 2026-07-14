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
