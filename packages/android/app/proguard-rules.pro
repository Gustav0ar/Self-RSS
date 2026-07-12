# Navigation 3 restores NavKeys through their runtime class names and generated
# Kotlin serialization adapters. Keep this tiny route set stable across a
# process-death restore and an app update.
-keep class com.selffeed.android.ui.ArticleListDestination { *; }
-keep class com.selffeed.android.ui.ArticleDetailDestination { *; }
