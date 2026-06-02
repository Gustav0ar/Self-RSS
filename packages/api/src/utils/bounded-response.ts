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
