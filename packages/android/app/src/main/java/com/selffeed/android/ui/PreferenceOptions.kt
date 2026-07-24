package com.selffeed.android.ui

import androidx.annotation.StringRes
import androidx.compose.ui.text.font.FontFamily
import com.selffeed.android.R
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
    @param:StringRes val labelRes: Int,
    val composeFontFamily: FontFamily,
    val cssFontFamily: String,
) {
    SYSTEM(
        apiValue = "system-ui",
        labelRes = R.string.reader_font_system,
        composeFontFamily = FontFamily.SansSerif,
        cssFontFamily = "system-ui, -apple-system, BlinkMacSystemFont, \\\"Roboto\\\", sans-serif",
    ),
    SANS(
        apiValue = "Inter",
        labelRes = R.string.reader_font_sans_serif,
        composeFontFamily = FontFamily.SansSerif,
        cssFontFamily = "Inter, Arial, Verdana, sans-serif",
    ),
    SERIF(
        apiValue = "Georgia",
        labelRes = R.string.reader_font_serif,
        composeFontFamily = FontFamily.Serif,
        cssFontFamily = "Georgia, \\\"Times New Roman\\\", serif",
    ),
    MONOSPACE(
        apiValue = "Courier New",
        labelRes = R.string.reader_font_monospace,
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
