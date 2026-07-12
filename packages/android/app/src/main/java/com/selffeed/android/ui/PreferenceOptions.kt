package com.selffeed.android.ui

import androidx.compose.ui.text.font.FontFamily
import com.selffeed.android.network.UserPreferences

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

enum class AutoMarkReadPreference(val apiValue: String) {
    DISABLED("disabled"),
    ON_NAVIGATE("on_navigate"),
    ON_OPEN("on_open"),
    ;

    companion object {
        fun fromApiValue(value: String?): AutoMarkReadPreference =
            entries.firstOrNull { it.apiValue == value } ?: ON_NAVIGATE
    }
}

enum class ReaderFontPreference(
    val apiValue: String,
    val label: String,
    val composeFontFamily: FontFamily,
    val cssFontFamily: String,
) {
    SYSTEM(
        apiValue = "system-ui",
        label = "System",
        composeFontFamily = FontFamily.SansSerif,
        cssFontFamily = "system-ui, -apple-system, BlinkMacSystemFont, \\\"Roboto\\\", sans-serif",
    ),
    SANS(
        apiValue = "Inter",
        label = "Sans serif",
        composeFontFamily = FontFamily.SansSerif,
        cssFontFamily = "Inter, Arial, Verdana, sans-serif",
    ),
    SERIF(
        apiValue = "Georgia",
        label = "Serif",
        composeFontFamily = FontFamily.Serif,
        cssFontFamily = "Georgia, \\\"Times New Roman\\\", serif",
    ),
    MONOSPACE(
        apiValue = "Courier New",
        label = "Monospace",
        composeFontFamily = FontFamily.Monospace,
        cssFontFamily = "\\\"Courier New\\\", monospace",
    ),
    ;

    companion object {
        fun fromApiValue(value: String?): ReaderFontPreference = when (value?.trim()) {
            "Georgia", "Times New Roman" -> SERIF
            "Courier New" -> MONOSPACE
            "Inter", "Arial", "Verdana" -> SANS
            else -> SYSTEM
        }
    }
}

data class ReaderAppearance(
    val textSizeSp: Int = 16,
    val font: ReaderFontPreference = ReaderFontPreference.SYSTEM,
) {
    val boundedTextSizeSp: Int get() = textSizeSp.coerceIn(12, 24)
}

fun UserPreferences.toReaderAppearance(): ReaderAppearance = ReaderAppearance(
    textSizeSp = textSize,
    font = ReaderFontPreference.fromApiValue(fontFamily),
)
