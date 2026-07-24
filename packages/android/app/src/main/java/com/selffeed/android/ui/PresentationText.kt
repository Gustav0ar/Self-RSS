package com.selffeed.android.ui

import android.content.res.Resources
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * User-facing text that stays independent of Android [android.content.Context]
 * until the UI resolves it for the current locale.
 *
 * [Dynamic] is reserved for already-localized or server-provided messages.
 */
sealed interface PresentationText {
    data class Resource(
        @param:StringRes val id: Int,
        val arguments: List<Any> = emptyList(),
    ) : PresentationText

    data class Plural(
        @param:PluralsRes val id: Int,
        val quantity: Int,
        val arguments: List<Any> = listOf(quantity),
    ) : PresentationText

    data class Dynamic(val value: String) : PresentationText

    data class Joined(
        val parts: List<PresentationText>,
        val separator: String,
    ) : PresentationText

    companion object {
        fun resource(@StringRes id: Int, vararg arguments: Any): PresentationText =
            Resource(id, arguments.toList())

        fun plural(@PluralsRes id: Int, quantity: Int, vararg arguments: Any): PresentationText =
            Plural(id, quantity, arguments.toList().ifEmpty { listOf(quantity) })

        fun dynamic(value: String): PresentationText = Dynamic(value)

        fun joined(parts: List<PresentationText>, separator: String = " · "): PresentationText =
            Joined(parts, separator)
    }
}

@Composable
fun PresentationText.resolve(): String = resolve(LocalContext.current.resources)

internal fun PresentationText.resolve(resources: Resources): String = when (this) {
    is PresentationText.Resource -> resources.getString(
        id,
        *arguments.map { argument ->
            if (argument is PresentationText) argument.resolve(resources) else argument
        }.toTypedArray(),
    )
    is PresentationText.Plural -> resources.getQuantityString(
        id,
        quantity,
        *arguments.map { argument ->
            if (argument is PresentationText) argument.resolve(resources) else argument
        }.toTypedArray(),
    )
    is PresentationText.Dynamic -> value
    is PresentationText.Joined -> parts.joinToString(separator) { it.resolve(resources) }
}
