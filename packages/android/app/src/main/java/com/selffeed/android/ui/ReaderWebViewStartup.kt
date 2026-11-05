package com.selffeed.android.ui

import android.content.Context
import android.util.Log
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewOutcomeReceiver
import androidx.webkit.WebViewStartUpConfig
import androidx.webkit.WebViewStartUpResult
import androidx.webkit.WebViewStartupException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asExecutor
import kotlinx.coroutines.withContext

/** Prepare Chromium while the signed-in list loads, before the first article transition. */
internal suspend fun prepareReaderWebView(context: Context) = withContext(Dispatchers.Default) {
    // WebKit initializes once per process and supports repeated calls after activity recreation.
    WebViewCompat.startUpWebView(
        context.applicationContext,
        WebViewStartUpConfig.Builder(Dispatchers.Default.asExecutor()).build(),
        object : WebViewOutcomeReceiver<WebViewStartUpResult, WebViewStartupException> {
            override fun onResult(result: WebViewStartUpResult) = Unit

            override fun onError(error: WebViewStartupException) {
                Log.w("ReaderWebViewStartup", "WebView startup failed", error)
            }
        },
    )
}
