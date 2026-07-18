export const MIN_SOURCE_INTERVAL_SECONDS = 15 * 60;

export interface PublisherScheduleHints {
	rssTtlSeconds: number | null;
	syndicationIntervalSeconds: number | null;
	httpMaxAgeSeconds: number | null;
	httpExpiresSeconds: number | null;
	effectiveIntervalSeconds: number;
}

const UPDATE_PERIOD_SECONDS: Record<string, number> = {
	hourly: 60 * 60,
	daily: 24 * 60 * 60,
	weekly: 7 * 24 * 60 * 60,
	monthly: 30 * 24 * 60 * 60,
	yearly: 365 * 24 * 60 * 60,
};

function text(value: unknown): string | null {
	if (typeof value === 'string') return value.trim() || null;
	if (typeof value === 'number') return String(value);
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return text(record._ ?? record['#text'] ?? record.value);
	}
	return null;
}

function positiveNumber(value: unknown): number | null {
	const parsed = Number(text(value));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function headerValue(
	headers: Headers | Record<string, string | null | undefined> | undefined,
	name: string,
) {
	if (!headers) return null;
	if (headers instanceof Headers) return headers.get(name);
	const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
	return entry?.[1] ?? null;
}

export function extractPublisherScheduleHints(
	feed: Record<string, unknown>,
	headers?: Headers | Record<string, string | null | undefined>,
	now = new Date(),
): PublisherScheduleHints {
	const ttlMinutes = positiveNumber(feed.ttl);
	const rssTtlSeconds = ttlMinutes == null ? null : Math.ceil(ttlMinutes * 60);

	const updatePeriod = text(feed['sy:updatePeriod'] ?? feed.updatePeriod)?.toLowerCase() ?? null;
	const updateFrequency = positiveNumber(feed['sy:updateFrequency'] ?? feed.updateFrequency) ?? 1;
	const periodSeconds = updatePeriod ? UPDATE_PERIOD_SECONDS[updatePeriod] : null;
	const syndicationIntervalSeconds = periodSeconds
		? Math.ceil(periodSeconds / updateFrequency)
		: null;

	const cacheControl = headerValue(headers, 'cache-control');
	const cacheAges = [
		...(cacheControl?.matchAll(/(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*"?(\d+)"?/gi) ?? []),
	]
		.map((match) => Number(match[1]))
		.filter(Number.isFinite);
	const httpMaxAgeSeconds = cacheAges.length > 0 ? Math.max(...cacheAges) : null;
	const expires = headerValue(headers, 'expires');
	const expiresAt = expires ? Date.parse(expires) : Number.NaN;
	const httpExpiresSeconds = Number.isFinite(expiresAt)
		? Math.max(0, Math.ceil((expiresAt - now.getTime()) / 1_000))
		: null;

	const effectiveIntervalSeconds = Math.max(
		MIN_SOURCE_INTERVAL_SECONDS,
		rssTtlSeconds ?? 0,
		syndicationIntervalSeconds ?? 0,
		httpMaxAgeSeconds ?? 0,
		httpExpiresSeconds ?? 0,
	);
	return {
		rssTtlSeconds,
		syndicationIntervalSeconds,
		httpMaxAgeSeconds,
		httpExpiresSeconds,
		effectiveIntervalSeconds,
	};
}
