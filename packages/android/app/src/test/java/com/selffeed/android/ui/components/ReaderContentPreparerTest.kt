package com.selffeed.android.ui.components

import com.selffeed.android.ui.ReaderAppearance
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@OptIn(ExperimentalCoroutinesApi::class)
class ReaderContentPreparerTest {
    private val input = ReaderHtmlInput(
        "<h2>Heading</h2><p>Readable &amp; safe.</p>",
        ReaderHtmlColors("#000000", "#ffffff", "#000000", "#ffffff", "#ffffff"),
        ReaderAppearance(), 1f, "https://example.invalid/article", 0xff000000.toInt(),
    )

    @Test fun `html preparation yields to its injected worker and preserves its exact render inputs`() = runTest {
        val preparer = ReaderContentPreparer(StandardTestDispatcher(testScheduler))
        val work = async(start = CoroutineStart.UNDISPATCHED) { preparer.html(input) }
        assertFalse("HTML construction ran on the caller", work.isCompleted)
        runCurrent()
        val result = work.await()
        assertEquals(input, result.input)
        assertTrue(result.document.contains("Readable &amp; safe."))
    }

    @Test fun `text preparation is cancellable before queued work runs`() = runTest {
        val preparer = ReaderContentPreparer(StandardTestDispatcher(testScheduler))
        val work = async(start = CoroutineStart.UNDISPATCHED) { preparer.text(input.html, null, null) }
        assertFalse("Text extraction ran on the caller", work.isCompleted)
        work.cancelAndJoin()
        runCurrent()
        assertTrue(work.isCancelled)
    }
}
