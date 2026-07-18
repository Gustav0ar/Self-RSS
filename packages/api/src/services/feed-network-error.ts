import type { FetchFailureKind } from './feed-fetch-outcome-policy.js';

export function classifyNetworkError(error: unknown): FetchFailureKind {
	const values: string[] = [];
	let current: unknown = error;
	for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
		const item = current as { code?: unknown; message?: unknown; cause?: unknown };
		values.push(String(item.code ?? ''), String(item.message ?? ''));
		current = item.cause;
	}
	const description = values.join(' ');
	if (/ENOTFOUND|EAI_AGAIN|DNS|name.*resolv/i.test(description)) return 'dns';
	if (/TLS|CERT|SSL|certificate|handshake/i.test(description)) return 'tls';
	return 'network';
}
