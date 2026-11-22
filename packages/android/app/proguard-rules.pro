# Navigation 3 restores NavKeys through their runtime class names and generated
# Kotlin serialization adapters. Keep this tiny route set stable across a
# process-death restore and an app update.
-keep class com.selffeed.android.ui.ArticleListDestination { *; }
-keep class com.selffeed.android.ui.ArticleDetailDestination { *; }

# Retrofit 3 uses reflection on interface method generic return/parameter types
# (e.g., ApiEnvelope<User>, ApiListResponse<ArticleListItem>) when resolving
# kotlinx.serialization converters. Keep the runtime serializer companion hooks
# on @Serializable DTOs in network and local packages under R8 strict full mode.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-if @kotlinx.serialization.Serializable class com.selffeed.android.**
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class com.selffeed.android.**
-keepclassmembers class <1>$Companion {
    kotlinx.serialization.KSerializer serializer(...);
}
