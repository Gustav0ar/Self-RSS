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
}
