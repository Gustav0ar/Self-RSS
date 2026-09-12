package com.selffeed.android.ui

import android.os.Bundle
import android.os.Parcel
import androidx.lifecycle.AbstractSavedStateViewModelFactory
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.test.core.app.ApplicationProvider
import com.selffeed.android.data.AppResult
import com.selffeed.android.data.RssRepository
import com.selffeed.android.data.SessionStore
import com.selffeed.android.data.local.LocalStore
import com.selffeed.android.network.ArticleDetail
import com.selffeed.android.network.NetworkModule
import com.selffeed.android.ui.articles.ArticleWarmingManager
import com.selffeed.android.ui.articles.EnrichmentManager
import com.selffeed.android.ui.articles.ReadStateManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ReadingSessionRestoreTest {
    @get:Rule val mainDispatcherRule = MainDispatcherRule()
    private val repository = mockk<RssRepository>(relaxed = true)
    private val sessionStore = mockk<SessionStore>(relaxed = true)
    private val session = "reader.example\nuser-1"
    private val detail = ArticleDetail(
        id = "article-1", feedId = "feed-1", guid = "article-1", title = "Read me",
        contentText = "Durable article body", hash = "hash", feedTitle = "Feed", isRead = true,
        isEnriched = true,
    )

    @Before
    fun setup() {
        every { repository.observeOnline() } returns MutableStateFlow(true)
        every { repository.articlePagingData(any(), any()) } returns emptyFlow()
        every { repository.savedStateRejections() } returns emptyFlow()
        every { repository.cachedArticleDetail(any()) } returns null
        coEvery { repository.article(detail.id, any()) } returns AppResult.Success(detail)
        coEvery { repository.readCachedArticleDetail(detail.id) } returns detail
    }

    @Test
    fun `fresh ViewModels restore Bundle identifiers from Room only after matching authentication`() = runTest {
        val local = LocalStore(ApplicationProvider.getApplicationContext(), NetworkModule.provideMoshi())
        val unreadDetail = detail.copy(isRead = false)
        local.writeArticleDetail(unreadDetail)
        coEvery { repository.article(detail.id, any()) } returns AppResult.Success(unreadDetail)
        coEvery { repository.readCachedArticleDetail(detail.id) } coAnswers { local.readArticleDetail(detail.id) }
        val first = Owner()
        val app = app(first)
        val articles = articles(first)
        app.bindReadingSession(session)
        articles.restoreReadingSession(session)
        articles.setScope("feed-1", null)
        articles.setFilter("oldest", true)
        articles.setAutoMarkReadMode("disabled")
        articles.openArticle(detail.id)
        runCurrent()
        app.openReaderFrom(HomeTab.SEARCH)
        val saved = first.saveAndDestroy()

        val recreated = Owner(saved)
        val nextApp = app(recreated)
        val nextArticles = articles(recreated)
        assertNull(nextArticles.state.value.selectedArticle)
        assertNull(nextArticles.state.value.selectedFeedId)
        assertEquals(HomeTab.ARTICLES, nextApp.chrome.value.readerOrigin)
        coVerify(exactly = 0) { repository.readCachedArticleDetail(any()) }

        nextApp.bindReadingSession(session)
        nextArticles.restoreReadingSession(session)
        nextApp.finishReadingSessionRestore()
        nextArticles.applyPreferences("newest", false, "disabled")
        assertEquals("feed-1", nextArticles.state.value.selectedFeedId)
        assertEquals("oldest", nextArticles.state.value.sort)
        assertTrue(nextArticles.state.value.hideRead)
        assertEquals(unreadDetail, nextArticles.state.value.selectedArticle)
        assertEquals(HomeTab.SEARCH, nextApp.chrome.value.readerOrigin)
        assertFalse(nextApp.chrome.value.restoringReadingSession)
        assertEquals(AutoMarkReadPreference.DISABLED, nextArticles.state.value.autoMarkReadMode)
        nextApp.bindReadingSession(session)
        nextArticles.restoreReadingSession(session)
        assertEquals(unreadDetail, nextArticles.state.value.selectedArticle)
        assertEquals("oldest", nextArticles.state.value.sort)
        nextArticles.applyPreferences("newest", false, "on_open")
        assertEquals("newest", nextArticles.state.value.sort)
        assertFalse(nextArticles.state.value.hideRead)
        coVerify(exactly = 1) { repository.article(any(), any()) }
        coVerify(exactly = 0) { repository.markRead(any(), any(), any()) }
        nextApp.closeReader()
        assertEquals(HomeTab.SEARCH, nextApp.chrome.value.activeTab)
        recreated.destroy()
    }

    @Test
    fun `saved tab and filter survive recreation without opening a reader`() = runTest {
        val first = Owner()
        val currentApp = app(first)
        val currentArticles = articles(first)
        currentApp.bindReadingSession(session)
        currentArticles.restoreReadingSession(session)
        currentArticles.setSavedOnly(true)
        currentApp.setTab(HomeTab.SAVED)
        val nextOwner = Owner(first.saveAndDestroy())
        val nextApp = app(nextOwner)
        val nextArticles = articles(nextOwner)
        nextApp.bindReadingSession(session)
        nextArticles.restoreReadingSession(session)
        assertEquals(HomeTab.SAVED, nextApp.chrome.value.activeTab)
        assertTrue(nextArticles.state.value.savedOnly)
        assertNull(nextArticles.state.value.selectedArticle)
        nextOwner.destroy()
    }

    @Test
    fun `server or account change discards saved reader and filters without reading old cache`() = runTest {
        for (otherSession in listOf("other.example\nuser-1", "reader.example\nuser-2")) {
            val first = Owner()
            val oldApp = app(first)
            val oldArticles = articles(first)
            oldApp.bindReadingSession(session)
            oldArticles.restoreReadingSession(session)
            oldArticles.setSavedOnly(true)
            oldArticles.openArticle(detail.id)
            runCurrent()
            oldApp.openReaderFrom(HomeTab.SAVED)
            val recreated = Owner(first.saveAndDestroy())
            val nextApp = app(recreated)
            val nextArticles = articles(recreated)
            nextApp.bindReadingSession(otherSession)
            nextArticles.restoreReadingSession(otherSession)
            assertNull(nextArticles.state.value.selectedArticle)
            assertFalse(nextArticles.state.value.savedOnly)
            assertEquals(HomeTab.ARTICLES, nextApp.chrome.value.activeTab)
            recreated.destroy()
        }
        coVerify(exactly = 0) { repository.readCachedArticleDetail(any()) }
    }

    @Test
    fun `logout clears saved identifiers and late cache restore cannot reopen the reader`() = runTest {
        val owner = Owner()
        val currentApp = app(owner)
        val current = articles(owner)
        currentApp.bindReadingSession(session)
        current.restoreReadingSession(session)
        current.openArticle(detail.id)
        runCurrent()
        val restoredOwner = Owner(owner.saveAndDestroy())
        val pending = CompletableDeferred<ArticleDetail?>()
        coEvery { repository.readCachedArticleDetail(detail.id) } coAnswers { pending.await() }
        val nextApp = app(restoredOwner)
        val next = articles(restoredOwner)
        nextApp.bindReadingSession(session)
        val restoring = async { next.restoreReadingSession(session) }
        runCurrent()
        next.clearReadingSession()
        nextApp.clearReadingSession()
        pending.complete(detail)
        restoring.await()
        assertNull(next.state.value.selectedArticle)
        val loggedOutOwner = Owner(restoredOwner.saveAndDestroy())
        val loggedOut = articles(loggedOutOwner)
        loggedOut.restoreReadingSession(session)
        assertNull(loggedOut.state.value.selectedArticle)
        assertEquals(HomeTab.ARTICLES, app(loggedOutOwner).chrome.value.activeTab)
        loggedOutOwner.destroy()
    }

    @Test
    fun `a repeated bootstrap resumes an interrupted cache restore for the same account`() = runTest {
        val owner = Owner()
        val current = articles(owner)
        current.restoreReadingSession(session)
        current.openArticle(detail.id)
        runCurrent()
        val nextOwner = Owner(owner.saveAndDestroy())
        val next = articles(nextOwner)
        val blocked = CompletableDeferred<ArticleDetail?>()
        coEvery { repository.readCachedArticleDetail(detail.id) } coAnswers { blocked.await() }
        val interrupted = async { next.restoreReadingSession(session) }
        runCurrent()
        interrupted.cancelAndJoin()
        coEvery { repository.readCachedArticleDetail(detail.id) } returns detail
        next.restoreReadingSession(session)
        assertEquals(detail, next.state.value.selectedArticle)
        nextOwner.destroy()
    }

    @Test
    fun `missing cached reader falls back to the restored category list`() = runTest {
        val owner = Owner()
        val current = articles(owner)
        current.restoreReadingSession(session)
        current.setScope(null, "category-1")
        current.openArticle(detail.id)
        runCurrent()
        val nextOwner = Owner(owner.saveAndDestroy())
        coEvery { repository.readCachedArticleDetail(detail.id) } returns null
        val next = articles(nextOwner)
        next.restoreReadingSession(session)
        assertNull(next.state.value.selectedArticle)
        assertEquals("category-1", next.state.value.selectedCategoryId)
        assertNull(next.state.value.errorMessage)
        nextOwner.destroy()
    }

    private fun app(owner: Owner): AppViewModel = owner.model("app", AppViewModel::class.java) {
        AppViewModel(repository, sessionStore, it)
    }

    private fun articles(owner: Owner): ArticlesViewModel = owner.model("articles", ArticlesViewModel::class.java) {
        ArticlesViewModel(repository, ReadStateManager(repository), EnrichmentManager(repository), ArticleWarmingManager(repository), it)
    }

    // A new registry, ViewModelStore and parceled Bundle model process recreation,
    // rather than configuration recreation that retains existing ViewModels.
    private class Owner(restored: Bundle? = null) : SavedStateRegistryOwner, ViewModelStoreOwner {
        private val registry = LifecycleRegistry(this)
        private val controller = SavedStateRegistryController.create(this)
        override val lifecycle: Lifecycle get() = registry
        override val savedStateRegistry get() = controller.savedStateRegistry
        override val viewModelStore = ViewModelStore()
        init {
            controller.performAttach()
            controller.performRestore(restored)
            registry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
        }
        fun <T : ViewModel> model(key: String, type: Class<T>, create: (SavedStateHandle) -> T): T {
            val factory = object : AbstractSavedStateViewModelFactory(this, null) {
                @Suppress("UNCHECKED_CAST")
                override fun <V : ViewModel> create(key: String, modelClass: Class<V>, handle: SavedStateHandle): V = create(handle) as V
            }
            return ViewModelProvider(this, factory)[key, type]
        }
        fun saveAndDestroy(): Bundle {
            val bundle = Bundle()
            controller.performSave(bundle)
            val parcel = Parcel.obtain()
            return try {
                parcel.writeBundle(bundle)
                val encoded = parcel.marshall()
                val restored = Parcel.obtain()
                try {
                    restored.unmarshall(encoded, 0, encoded.size)
                    restored.setDataPosition(0)
                    requireNotNull(restored.readBundle(javaClass.classLoader))
                } finally {
                    restored.recycle()
                }
            } finally {
                parcel.recycle()
                destroy()
            }
        }
        fun destroy() {
            registry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
            viewModelStore.clear()
        }
    }
}
