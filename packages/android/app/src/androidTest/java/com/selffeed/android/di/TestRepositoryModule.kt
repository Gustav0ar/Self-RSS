package com.selffeed.android.di

import com.selffeed.android.data.FakeSelfFeedRepository
import com.selffeed.android.data.repository.AppStatusRepository
import com.selffeed.android.data.repository.ArticleRepository
import com.selffeed.android.data.repository.AuthRepository
import com.selffeed.android.data.repository.FeedRepository
import com.selffeed.android.data.repository.SearchRepository
import com.selffeed.android.data.repository.SelfFeedRepository
import com.selffeed.android.data.repository.SettingsRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.components.SingletonComponent
import dagger.hilt.testing.TestInstallIn
import javax.inject.Singleton

@Module
@TestInstallIn(
    components = [SingletonComponent::class],
    replaces = [RepositoryBindingModule::class],
)
abstract class TestRepositoryModule {
    @Binds
    @Singleton
    abstract fun bindSelfFeedRepository(repository: FakeSelfFeedRepository): SelfFeedRepository

    @Binds
    abstract fun bindAuthRepository(repository: FakeSelfFeedRepository): AuthRepository

    @Binds
    abstract fun bindFeedRepository(repository: FakeSelfFeedRepository): FeedRepository

    @Binds
    abstract fun bindArticleRepository(repository: FakeSelfFeedRepository): ArticleRepository

    @Binds
    abstract fun bindSearchRepository(repository: FakeSelfFeedRepository): SearchRepository

    @Binds
    abstract fun bindSettingsRepository(repository: FakeSelfFeedRepository): SettingsRepository

    @Binds
    abstract fun bindAppStatusRepository(repository: FakeSelfFeedRepository): AppStatusRepository
}
