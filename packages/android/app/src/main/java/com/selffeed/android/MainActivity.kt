package com.selffeed.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.core.view.WindowCompat
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
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContent {
            val state by viewModel.uiState.collectAsStateWithLifecycle()
            val theme = state.preferences?.theme ?: "system"
            val isAmoled = theme == "amoled"
            val darkTheme = when (theme) {
                "light" -> false
                "dark", "amoled" -> true
                else -> isSystemInDarkTheme()
            }
            SelfFeedTheme(darkTheme = darkTheme, isAmoled = isAmoled) {
                SelfFeedApp(viewModel)
            }
        }
    }
}
