package com.selffeed.android.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PreferenceOptionsTest {
    @Test
    fun themePreference_mapsLegacyAmoledToDark() {
        assertEquals(ThemePreference.DARK, ThemePreference.fromApiValue("amoled"))
        assertEquals("dark", ThemePreference.fromApiValue("amoled").apiValue)
    }

    @Test
    fun themePreference_defaultsUnknownValuesToSystem() {
        assertEquals(ThemePreference.SYSTEM, ThemePreference.fromApiValue(null))
        assertEquals(ThemePreference.SYSTEM, ThemePreference.fromApiValue("unexpected"))
    }

    @Test
    fun articleSortPreference_defaultsUnknownValuesToLatest() {
        assertEquals(ArticleSortPreference.OLDEST, ArticleSortPreference.fromApiValue("oldest"))
        assertEquals(ArticleSortPreference.LATEST, ArticleSortPreference.fromApiValue("newest-first"))
    }

    @Test
    fun densityPreference_defaultsUnknownValuesToComfortable() {
        assertEquals(DensityPreference.COMPACT, DensityPreference.fromApiValue("compact"))
        assertEquals(DensityPreference.COMFORTABLE, DensityPreference.fromApiValue("wide"))
    }

    @Test
    fun readerPreferences_mapSupportedApiValuesAndBoundTextSize() {
        assertEquals(ReaderFontPreference.SERIF, ReaderFontPreference.fromApiValue("Georgia"))
        assertEquals(ReaderFontPreference.MONOSPACE, ReaderFontPreference.fromApiValue("Courier New"))
        assertEquals(ReaderFontPreference.SYSTEM, ReaderFontPreference.fromApiValue("unknown"))
        assertEquals(12, ReaderAppearance(textSizeSp = 4).boundedTextSizeSp)
        assertEquals(24, ReaderAppearance(textSizeSp = 100).boundedTextSizeSp)
    }

    @Test
    fun autoMarkReadPreference_defaultsToNavigation() {
        assertEquals(AutoMarkReadPreference.ON_OPEN, AutoMarkReadPreference.fromApiValue("on_open"))
        assertEquals(AutoMarkReadPreference.DISABLED, AutoMarkReadPreference.fromApiValue("disabled"))
        assertEquals(AutoMarkReadPreference.ON_NAVIGATE, AutoMarkReadPreference.fromApiValue("unknown"))
    }
}
