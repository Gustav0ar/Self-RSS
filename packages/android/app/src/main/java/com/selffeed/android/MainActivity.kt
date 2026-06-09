package com.selffeed.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.selffeed.android.ui.MainViewModel
import com.selffeed.android.ui.MainViewModelFactory
import com.selffeed.android.ui.SelfFeedApp
import com.selffeed.android.ui.theme.SelfFeedTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels {
        MainViewModelFactory((application as SelfFeedApplication).repository)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val state by viewModel.uiState.collectAsStateWithLifecycle()
            val theme = normalizeThemePreference(state.preferences?.theme ?: "system")
            val darkTheme = when (theme) {
                "light" -> false
                "dark" -> true
                else -> isSystemInDarkTheme()
            }
            SelfFeedTheme(darkTheme = darkTheme) {
                SelfFeedApp(viewModel)
            }
        }
    }

    private fun normalizeThemePreference(theme: String): String =
        if (theme == "amoled") "dark" else theme
}
