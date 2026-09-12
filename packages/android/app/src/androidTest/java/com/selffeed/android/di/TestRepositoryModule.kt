package com.selffeed.android.di

import com.selffeed.android.data.FakeSelfFeedRepository
import com.selffeed.android.data.repository.AppStatusRepository
import com.selffeed.android.data.repository.AuthRepository
import com.selffeed.android.data.repository.SelfFeedRepository
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
    abstract fun bindAppStatusRepository(repository: FakeSelfFeedRepository): AppStatusRepository
}
