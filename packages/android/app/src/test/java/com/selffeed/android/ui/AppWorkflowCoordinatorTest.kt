package com.selffeed.android.ui

import com.selffeed.android.network.UserPreferences
import org.junit.Assert.assertEquals
import org.junit.Test

class AppWorkflowCoordinatorTest {
    private val coordinator = AppWorkflowCoordinator()

    @Test
    fun `authentication transition refreshes or clears feature session state`() {
        val sink = RecordingSink()

        coordinator.onAuthenticationChanged(isAuthenticated = true, sink = sink)
        coordinator.onAuthenticationChanged(isAuthenticated = false, sink = sink)

        assertEquals(1, sink.authenticatedRefreshes)
        assertEquals(1, sink.unauthenticatedClears)
    }

    @Test
    fun `preference transition updates article filtering and auto-mark policy together`() {
        val sink = RecordingSink()

        coordinator.onPreferencesChanged(
            UserPreferences(
                theme = "system",
                fontFamily = "system-ui",
                textSize = 16,
                density = "comfortable",
                defaultSort = "oldest",
                hideRead = true,
                keyboardShortcutsEnabled = true,
                autoMarkReadMode = "on_open",
            ),
            sink,
        )

        assertEquals(listOf(Triple("oldest", true, "on_open")), sink.preferenceUpdates)
    }

    @Test
    fun `only completed background sync revisions refresh dependent feature data`() {
        val sink = RecordingSink()

        coordinator.onFeedSyncRevisionChanged(0L, sink)
        coordinator.onFeedSyncRevisionChanged(1L, sink)

        assertEquals(1, sink.syncRefreshes)
    }

    private class RecordingSink : AppWorkflowSink {
        var authenticatedRefreshes = 0
        var unauthenticatedClears = 0
        var syncRefreshes = 0
        val preferenceUpdates = mutableListOf<Triple<String, Boolean, String>>()

        override fun refreshAuthenticatedSession() {
            authenticatedRefreshes += 1
        }

        override fun clearUnauthenticatedSession() {
            unauthenticatedClears += 1
        }

        override fun applyArticlePreferences(defaultSort: String, hideRead: Boolean, autoMarkReadMode: String) {
            preferenceUpdates += Triple(defaultSort, hideRead, autoMarkReadMode)
        }

        override fun refreshAfterFeedSync() {
            syncRefreshes += 1
        }

        override fun applyUnreadDelta(feedId: String?, unreadDelta: Int) = Unit
        override fun applyStatsDelta(unreadDelta: Int, readDelta: Int) = Unit
        override fun applyArticleReadState(articleId: String, read: Boolean) = Unit
        override fun applyScopeMarkedRead(feedId: String?, categoryId: String?, affectedFeedIds: Set<String>) = Unit
        override fun applySearchScopeMarkedRead(feedIds: Set<String>) = Unit
        override fun applyAllSearchMarkedRead() = Unit
        override fun refreshArticleContent() = Unit
    }
}
