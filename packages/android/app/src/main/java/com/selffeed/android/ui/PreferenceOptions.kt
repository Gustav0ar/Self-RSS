package com.selffeed.android.ui

enum class ThemePreference(val apiValue: String) {
    LIGHT("light"),
    DARK("dark"),
    SYSTEM("system"),
    ;

    companion object {
        fun fromApiValue(value: String?): ThemePreference =
            when (value) {
                "light" -> LIGHT
                "dark", "amoled" -> DARK
                else -> SYSTEM
            }
    }
}

enum class ArticleSortPreference(val apiValue: String) {
    LATEST("latest"),
    OLDEST("oldest"),
    ;

    companion object {
        fun fromApiValue(value: String?): ArticleSortPreference =
            when (value) {
                "oldest" -> OLDEST
                else -> LATEST
            }
    }
}

enum class DensityPreference(val apiValue: String) {
    COMFORTABLE("comfortable"),
    COMPACT("compact"),
    ;

    companion object {
        fun fromApiValue(value: String?): DensityPreference =
            when (value) {
                "compact" -> COMPACT
                else -> COMFORTABLE
            }
    }
}
