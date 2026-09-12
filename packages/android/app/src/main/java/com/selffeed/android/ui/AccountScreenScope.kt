package com.selffeed.android.ui

import android.os.Bundle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.lifecycle.viewmodel.HiltViewModelFactory
import androidx.lifecycle.DEFAULT_ARGS_KEY
import androidx.lifecycle.HasDefaultViewModelProviderFactory
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.MutableCreationExtras
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.rememberDecoratedNavEntries
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator

internal const val ACCOUNT_OWNER_ID_ARGUMENT = "account.ownerId"

/** Retains one account through recreation and clears its models when that entry leaves. */
@Composable
internal fun AccountScreenScope(ownerId: String?, content: @Composable (String) -> Unit) {
    val latestContent by rememberUpdatedState(content)
    val history = viewModel<AccountEntryHistory>(factory = viewModelFactory {
        initializer { AccountEntryHistory(ownerId) }
    })
    var renderedOwner by remember(history) { mutableStateOf(history.ownerId) }
    val stackOwner = renderedOwner
    val entries = rememberDecoratedNavEntries(
        backStack = listOfNotNull(stackOwner),
        entryDecorators = listOf(
            rememberSaveableStateHolderNavEntryDecorator(),
            rememberViewModelStoreNavEntryDecorator(removeViewModelStoreOnPop = { true }),
        ),
    ) { owner ->
        NavEntry(owner, contentKey = "account:$owner") { latestContent(owner) }
    }
    if (stackOwner == ownerId) entries.singleOrNull()?.Content()
    SideEffect {
        // A stopped host can miss logout before recreation. First let Navigation3 observe
        // its retained entry, then pop it. Persist only membership it has actually processed,
        // so recreation between these compositions cannot orphan the previous store.
        history.ownerId = stackOwner
        renderedOwner = ownerId
    }
}

private class AccountEntryHistory(var ownerId: String?) : ViewModel()

/** Supplies the explicit account argument to Hilt and the entry's SavedStateHandle. */
@Composable
internal inline fun <reified VM : ViewModel> accountViewModel(ownerId: String): VM {
    val owner = checkNotNull(LocalViewModelStoreOwner.current)
    check(owner is HasDefaultViewModelProviderFactory)
    val context = LocalContext.current
    val factory = remember(context, owner) {
        HiltViewModelFactory(context, owner.defaultViewModelProviderFactory)
    }
    val extras = remember(owner, ownerId) {
        MutableCreationExtras(owner.defaultViewModelCreationExtras).apply {
            this[DEFAULT_ARGS_KEY] = Bundle().apply { putString(ACCOUNT_OWNER_ID_ARGUMENT, ownerId) }
        }
    }
    return viewModel(viewModelStoreOwner = owner, factory = factory, extras = extras)
}
