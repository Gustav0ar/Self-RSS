package com.selffeed.android.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel

/** A test controls each response independently, including acknowledgements returned out of order. */
class ReviewRequestGate<I, O> {
    class Request<I, O>(val input: I) {
        val response = CompletableDeferred<O>()
    }

    private val requests = Channel<Request<I, O>>(Channel.UNLIMITED)

    suspend fun next(): Request<I, O> = requests.receive()

    suspend fun await(input: I): O {
        val request = Request<I, O>(input)
        requests.send(request)
        try {
            return request.response.await()
        } finally {
            request.response.cancel()
        }
    }
}
