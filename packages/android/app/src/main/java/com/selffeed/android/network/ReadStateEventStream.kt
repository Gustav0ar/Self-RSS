package com.selffeed.android.network

import com.squareup.moshi.JsonAdapter

data class SseMessage(
    val eventName: String,
    val data: String,
)

class SseEventParser {
    private var eventName = "message"
    private val dataLines = mutableListOf<String>()

    fun pushLine(rawLine: String): SseMessage? {
        val line = rawLine.removeSuffix("\r")
        if (line.isEmpty()) {
            return dispatch()
        }
        if (line.startsWith(":")) {
            return null
        }

        val separator = line.indexOf(':')
        val field = if (separator == -1) line else line.substring(0, separator)
        val rawValue = if (separator == -1) "" else line.substring(separator + 1)
        val value = rawValue.removePrefix(" ")

        when (field) {
            "event" -> eventName = value.ifBlank { "message" }
            "data" -> dataLines += value
        }

        return null
    }

    fun flush(): SseMessage? = dispatch()

    private fun dispatch(): SseMessage? {
        if (dataLines.isEmpty()) {
            eventName = "message"
            return null
        }

        val message = SseMessage(eventName = eventName, data = dataLines.joinToString("\n"))
        eventName = "message"
        dataLines.clear()
        return message
    }
}

fun SseMessage.toReadStateEvent(adapter: JsonAdapter<ReadStateEventPayload>): ReadStateSyncEvent? {
    if (eventName != "read-state") {
        return null
    }

    return runCatching { adapter.fromJson(data)?.toEvent() }.getOrNull()
}
