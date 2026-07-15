package com.selffeed.android.ui.articles

import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.network.RealtimeConnectedEvent
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.ui.ArticleFeatureEvent
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadStateManagerTest {
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `realtime reconnect flushes pending state clears session overlays and requests refresh`() = runTest {
        val repository = mockk<ArticleRepository>(relaxed = true)
        val syncEvents = MutableSharedFlow<ReadStateSyncEvent>(extraBufferCapacity = 1)
        every { repository.readStateEvents() } returns syncEvents
        every { repository.clientId() } returns "client-local"
        coEvery { repository.invalidateReadStateCaches() } returns Unit
        val manager = ReadStateManager(repository)
        manager.setScope(backgroundScope)
        manager.readStateStore.remember("article-1", true)
        manager.startReadStateSync()
        val emittedEvent = async { manager.events.first() }
        runCurrent()

        syncEvents.emit(RealtimeConnectedEvent())
        runCurrent()

        coVerify(exactly = 1) { repository.invalidateReadStateCaches() }
        assertTrue(manager.knownArticleReadStates().isEmpty())
        assertTrue(emittedEvent.await() is ArticleFeatureEvent.ArticlesChanged)
        manager.stopReadStateSync()
    }
}
