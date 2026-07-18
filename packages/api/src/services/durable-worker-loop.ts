function waitFor(ms: number, signal: AbortSignal) {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(finish, Math.max(0, ms));
		function finish() {
			signal.removeEventListener('abort', abort);
			resolve();
		}
		function abort() {
			clearTimeout(timer);
			reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
		}
		signal.addEventListener('abort', abort, { once: true });
	});
}

export async function withLeaseHeartbeat<T>(options: {
	operation: () => Promise<T>;
	renew: () => Promise<unknown>;
	leaseSeconds: number;
	signal?: AbortSignal;
}) {
	const intervalMs = Math.max(250, Math.floor((options.leaseSeconds * 1_000) / 3));
	let renewal = Promise.resolve<unknown>(undefined);
	let renewalError: unknown;
	const timer = setInterval(() => {
		if (options.signal?.aborted) return;
		renewal = renewal.then(options.renew).catch((error) => {
			renewalError = error;
		});
	}, intervalMs);
	try {
		const result = await options.operation();
		await renewal;
		if (renewalError) throw renewalError;
		return result;
	} finally {
		clearInterval(timer);
	}
}

/** Awaited ticks guarantee timer cycles never overlap. */
export async function runNonOverlappingLoop(options: {
	tick: (signal: AbortSignal) => Promise<unknown>;
	intervalMs: number;
	signal: AbortSignal;
}) {
	while (!options.signal.aborted) {
		await options.tick(options.signal);
		try {
			await waitFor(options.intervalMs, options.signal);
		} catch {
			if (!options.signal.aborted) throw new Error('Durable worker loop wait failed');
		}
	}
}
