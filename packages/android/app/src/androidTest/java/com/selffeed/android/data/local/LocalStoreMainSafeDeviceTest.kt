package com.selffeed.android.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalStoreMainSafeDeviceTest : LocalStoreMainSafeContract() {
    override suspend fun onCaller(block: suspend () -> Unit) = withContext(Dispatchers.Main.immediate) { block() }
}
