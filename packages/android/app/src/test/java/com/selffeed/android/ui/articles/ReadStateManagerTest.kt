package com.selffeed.android.ui.articles

import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.network.ArticleReadStateChangedEvent
import com.selffeed.android.network.ArticleSavedStateChangedEvent
import com.selffeed.android.network.ReadStateSyncEvent
import com.selffeed.android.network.RealtimeConnectedEvent
import com.selffeed.android.ui.ArticleFeatureEventCoordinator
import com.selffeed.android.ui.ArticleFeatureEventSink
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReadStateManagerTest {
    @Test
    fun `reconnect refreshes membership for articles missed while disconnected`() = runTest {
        val fixture = observeRealtime()

        fixture.events.emit(RealtimeConnectedEvent())
        runCurrent()

        coVerify(exactly = 1) { fixture.repository.invalidateReadStateCaches() }
        coVerify(exactly = 0) { fixture.repository.invalidateArticleContentCaches(any()) }
        assertEquals(1, fixture.sink.membershipRefreshes)
        assertEquals(0, fixture.sink.stateRefreshes)
    }

    @Test
    fun `remote saves and unsaves reconcile membership after committing their flags`() = runTest {
        val fixture = observeRealtime()
        var committedFlags = 0
        coEvery { fixture.repository.updateCachedSavedState(any(), any(), any()) } answers {
            committedFlags++
        }
        fixture.sink.onMembershipRefresh = {
            assertEquals(committedFlags, fixture.sink.membershipRefreshes)
        }

        for (revision in listOf(1, null)) {
            for (saved in listOf(true, false)) {
                fixture.events.emit(ArticleSavedStateChangedEvent(
                    eventId = "remote-save-$revision-$saved",
                    articleId = "unseen-saved",
                    feedId = "feed",
                    isSaved = saved,
                    revision = revision,
                    clientId = "web",
                    updatedAt = "2026-09-12T12:00:00Z",
                ))
                runCurrent()

                coVerify(exactly = 1) {
                    fixture.repository.updateCachedSavedState("unseen-saved", saved, revision)
                }
            }
        }

        assertEquals(4, fixture.sink.membershipRefreshes)
        assertEquals(0, fixture.sink.stateRefreshes)
    }

    @Test
    fun `versioned read flags do not refresh article membership`() = runTest {
        val fixture = observeRealtime()

        fixture.events.emit(readEvent(revision = 3))
        runCurrent()

        coVerify(exactly = 1) { fixture.repository.updateCachedReadState("article", true, 3) }
        assertEquals(0, fixture.sink.membershipRefreshes)
        assertEquals(0, fixture.sink.stateRefreshes)
    }

    @Test
    fun `unversioned read flags request only a bounded state refresh`() = runTest {
        val fixture = observeRealtime()

        fixture.events.emit(readEvent(revision = null))
        runCurrent()

        coVerify(exactly = 1) { fixture.repository.updateCachedReadState("article", true, null) }
        assertEquals(0, fixture.sink.membershipRefreshes)
        assertEquals(1, fixture.sink.stateRefreshes)
    }

    private fun readEvent(revision: Int?) = ArticleReadStateChangedEvent(
        eventId = "remote-read",
        articleId = "article",
        feedId = "feed",
        isRead = true,
        revision = revision,
        source = "manual",
        clientId = "web",
        updatedAt = "2026-09-12T12:00:00Z",
    )

    private fun TestScope.observeRealtime(): RealtimeFixture {
        val repository = mockk<ArticleRepository>(relaxed = true)
        val events = MutableSharedFlow<ReadStateSyncEvent>(extraBufferCapacity = 1)
        every { repository.readStateEvents() } returns events
        every { repository.clientId() } returns "client-local"
        val manager = ReadStateManager(repository)
        val sink = RefreshSink()
        backgroundScope.launch { manager.observeReadStateSync() }
        backgroundScope.launch {
            val coordinator = ArticleFeatureEventCoordinator()
            manager.events.collect { coordinator.handle(it, sink) }
        }
        runCurrent()
        return RealtimeFixture(repository, events, sink)
    }

    private data class RealtimeFixture(
        val repository: ArticleRepository,
        val events: MutableSharedFlow<ReadStateSyncEvent>,
        val sink: RefreshSink,
    )

    private class RefreshSink : ArticleFeatureEventSink {
        var stateRefreshes = 0
        var membershipRefreshes = 0
        var onMembershipRefresh: () -> Unit = {}

        override fun refreshArticleState() { stateRefreshes++ }

        override fun refreshArticleContent() {
            membershipRefreshes++
            onMembershipRefresh()
        }
    }
}
