import { describe, expect, it, vi } from 'vitest';
import {
	readResponseBytesWithinLimit,
	readResponseTextWithinLimit,
} from '../../src/utils/bounded-response.js';

function stallingResponse() {
	const cancel = vi.fn();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('<rss>'));
		},
		cancel,
	});
	return { cancel, response: new Response(body) };
}

describe('bounded response readers', () => {
	it('aborts and cancels a response that stalls while reading text', async () => {
		const controller = new AbortController();
		const { cancel, response } = stallingResponse();
		const read = readResponseTextWithinLimit(response, 1_000, controller);

		controller.abort();

		await expect(read).rejects.toMatchObject({ name: 'AbortError' });
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('aborts and cancels a response that stalls while reading bytes', async () => {
		const controller = new AbortController();
		const { cancel, response } = stallingResponse();
		const read = readResponseBytesWithinLimit(response, 1_000, controller);

		controller.abort();

		await expect(read).rejects.toMatchObject({ name: 'AbortError' });
		expect(cancel).toHaveBeenCalledOnce();
	});
});
