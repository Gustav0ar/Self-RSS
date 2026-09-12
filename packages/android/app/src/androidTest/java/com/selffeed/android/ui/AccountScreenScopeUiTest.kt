package com.selffeed.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.job
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AccountScreenScopeUiTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun replacementsClearEveryDepartedModelAndItsCoroutineScope() {
        val owner = mutableStateOf<String?>("owner-0")
        val models = mutableMapOf<String, Probe>()
        composeRule.setContent {
            AccountScreenScope(owner.value) { key ->
                val model = viewModel<Probe>(factory = viewModelFactory {
                    initializer { Probe(createSavedStateHandle()) }
                })
                SideEffect { models[key] = model }
            }
        }
        repeat(5) { index ->
            composeRule.runOnIdle {
                assertEquals(1, models.values.count { !it.cleared })
                assertFalse(models.getValue("owner-$index").job.isCancelled)
                owner.value = "owner-${index + 1}"
            }
            composeRule.runOnIdle {
                assertTrue(models.getValue("owner-$index").cleared)
                assertTrue(models.getValue("owner-$index").job.isCancelled)
                assertEquals(1, models.values.count { !it.cleared })
            }
        }
        composeRule.runOnIdle { owner.value = null }
        composeRule.runOnIdle {
            assertTrue(models.values.all { it.cleared && it.job.isCancelled })
        }
    }

    @Test
    fun sameOwnerRetainsItsModelButPoppedStateCannotReturn() {
        val owner = mutableStateOf<String?>("owner-a")
        val revision = mutableStateOf(0)
        var current: Probe? = null
        composeRule.setContent {
            revision.value
            AccountScreenScope(owner.value) {
                val model = viewModel<Probe>(factory = viewModelFactory {
                    initializer { Probe(createSavedStateHandle()) }
                })
                SideEffect { current = model }
            }
        }
        lateinit var original: Probe
        composeRule.runOnIdle {
            original = checkNotNull(current)
            original.savedState["draft"] = "account-specific draft"
            revision.value++
        }
        composeRule.runOnIdle {
            assertSame(original, current)
            assertEquals("account-specific draft", current?.savedState?.get<String>("draft"))
            owner.value = null
        }
        composeRule.runOnIdle {
            assertTrue(original.cleared)
            owner.value = "owner-a"
        }
        composeRule.runOnIdle {
            assertNotSame(original, current)
            assertNull(current?.savedState?.get<String>("draft"))
        }
    }

    private class Probe(val savedState: SavedStateHandle) : ViewModel() {
        val job = viewModelScope.coroutineContext.job
        var cleared = false
            private set
        override fun onCleared() { cleared = true }
    }
}
