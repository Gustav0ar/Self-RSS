export async function readResponseTextWithinLimit(
	response: Response,
	maxBytes: number,
	controller?: AbortController,
) {
	const reader = response.body?.getReader();
	if (!reader) {
		const text = await response.text();
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
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			controller?.abort();
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
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxBytes) {
			controller?.abort();
			throw new Error('Feed content exceeds maximum size');
		}
		return bytes;
	}

	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			controller?.abort();
			await reader.cancel().catch(() => undefined);
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
