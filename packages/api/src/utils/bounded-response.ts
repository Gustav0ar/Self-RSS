function abortReason(signal: AbortSignal) {
	return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

/**
 * Start releasing an unused response body without making the caller wait for
 * the stream implementation's cancellation promise. Some Node/Bun web-stream
 * adapters can leave that promise pending after the underlying socket closes.
 */
export function cancelResponseBody(response: Response) {
	void response.body?.cancel().catch(() => undefined);
}

function raceWithAbort<T>(
	operation: Promise<T>,
	signal: AbortSignal | undefined,
	onAbort: () => void,
) {
	if (!signal) return operation;
	if (signal.aborted) {
		onAbort();
		return Promise.reject(abortReason(signal));
	}

	return new Promise<T>((resolve, reject) => {
		const handleAbort = () => {
			onAbort();
			reject(abortReason(signal));
		};
		signal.addEventListener('abort', handleAbort, { once: true });
		operation.then(
			(value) => {
				signal.removeEventListener('abort', handleAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', handleAbort);
				reject(error);
			},
		);
	});
}

export async function readResponseTextWithinLimit(
	response: Response,
	maxBytes: number,
	controller?: AbortController,
) {
	const reader = response.body?.getReader();
	if (!reader) {
		const text = await raceWithAbort(response.text(), controller?.signal, () => undefined);
		if (new TextEncoder().encode(text).length > maxBytes) {
			controller?.abort();
			throw new Error('Feed content exceeds maximum size');
		}
		return text;
	}

	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let totalBytes = 0;

	while (true) {
		const { done, value } = await raceWithAbort(reader.read(), controller?.signal, () => {
			void reader.cancel(abortReason(controller!.signal)).catch(() => undefined);
		});
		if (done) {
			break;
		}

		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			controller?.abort();
			void reader.cancel().catch(() => undefined);
			throw new Error('Feed content exceeds maximum size');
		}

		chunks.push(decoder.decode(value, { stream: true }));
	}

	chunks.push(decoder.decode());
	return chunks.join('');
}

export async function readResponseBytesWithinLimit(
	response: Response,
	maxBytes: number,
	controller?: AbortController,
) {
	const reader = response.body?.getReader();
	if (!reader) {
		const bytes = new Uint8Array(
			await raceWithAbort(response.arrayBuffer(), controller?.signal, () => undefined),
		);
		if (bytes.byteLength > maxBytes) {
			controller?.abort();
			throw new Error('Feed content exceeds maximum size');
		}
		return bytes;
	}

	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await raceWithAbort(reader.read(), controller?.signal, () => {
			void reader.cancel(abortReason(controller!.signal)).catch(() => undefined);
		});
		if (done) break;

		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			controller?.abort();
			void reader.cancel().catch(() => undefined);
			throw new Error('Feed content exceeds maximum size');
		}
		chunks.push(value);
	}

	const result = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}
