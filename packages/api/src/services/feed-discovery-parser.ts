import { normalizeFeedSourceUrl } from '../utils/feed-source-url.js';

export interface FeedDiscoveryCandidate {
	url: string;
	title: string | null;
	type: 'rss' | 'atom' | 'json-feed' | 'candidate-path';
}

const FEED_TYPES = new Map<string, FeedDiscoveryCandidate['type']>([
	['application/rss+xml', 'rss'],
	['application/atom+xml', 'atom'],
	['application/feed+json', 'json-feed'],
	['application/json', 'json-feed'],
]);
const FALLBACK_PATHS = ['/feed', '/feed/', '/rss', '/rss.xml', '/atom.xml', '/feed.xml'];
const TAG_PATTERN = /<(base|link)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const ATTR_PATTERN =
	/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

function decodeHtmlEntities(raw: string): string {
	if (!raw.includes('&')) return raw;
	return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
		if (entity.startsWith('#x') || entity.startsWith('#X')) {
			const code = Number.parseInt(entity.slice(2), 16);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		if (entity.startsWith('#')) {
			const code = Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
	});
}

function parseTagAttributes(rawAttrs: string): Map<string, string> {
	const attrs = new Map<string, string>();
	ATTR_PATTERN.lastIndex = 0;
	for (const match of rawAttrs.matchAll(ATTR_PATTERN)) {
		const name = match[1]?.toLowerCase();
		if (!name || attrs.has(name)) continue;
		const value = match[2] ?? match[3] ?? match[4] ?? '';
		attrs.set(name, decodeHtmlEntities(value));
	}
	return attrs;
}

function safeCandidate(raw: string, base: string) {
	try {
		return normalizeFeedSourceUrl(new URL(raw, base).toString()).normalizedUrl;
	} catch {
		return null;
	}
}

/**
 * Extract feed discovery `<link rel="alternate">` candidates from HTML without
 * constructing a full DOM tree, honoring the first valid `<base href>`.
 */
export function discoverFeedsFromHtml(
	html: string,
	finalPageUrl: string,
	maxCandidates = 20,
): FeedDiscoveryCandidate[] {
	const limit = Math.max(0, Math.floor(maxCandidates));
	if (limit === 0 || !html) return [];

	let pageBase: string;
	try {
		pageBase = new URL(finalPageUrl).toString();
	} catch {
		return [];
	}

	// Strip HTML comments and script/style blocks so commented-out links are ignored.
	const cleaned = html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

	let baseUri = pageBase;
	let hasBase = false;
	const candidates = new Map<string, FeedDiscoveryCandidate>();

	TAG_PATTERN.lastIndex = 0;
	for (const match of cleaned.matchAll(TAG_PATTERN)) {
		const tagName = match[1]?.toLowerCase();
		const rawAttrs = match[2] ?? '';
		if (tagName === 'base') {
			if (!hasBase) {
				const href = parseTagAttributes(rawAttrs).get('href');
				if (href) {
					try {
						baseUri = new URL(href, pageBase).toString();
						hasBase = true;
					} catch {
						// Ignore invalid <base href> values.
					}
				}
			}
			continue;
		}

		if (candidates.size >= limit) break;
		const attrs = parseTagAttributes(rawAttrs);
		const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
		if (!rel.includes('alternate')) continue;
		const rawType = (attrs.get('type') ?? '').toLowerCase().split(';')[0]!.trim();
		const type = FEED_TYPES.get(rawType);
		if (!type) continue;
		const href = attrs.get('href');
		if (!href) continue;
		const resolved = safeCandidate(href, baseUri);
		if (!resolved || candidates.has(resolved)) continue;
		candidates.set(resolved, {
			url: resolved,
			title: attrs.get('title')?.trim() || null,
			type,
		});
	}

	return [...candidates.values()];
}

/** Returns paths for durable discovery jobs; callers must not probe them inline. */
export function buildFallbackDiscoveryCandidates(
	finalPageUrl: string,
	maxCandidates = FALLBACK_PATHS.length,
): FeedDiscoveryCandidate[] {
	let origin: string;
	try {
		origin = new URL(normalizeFeedSourceUrl(finalPageUrl).normalizedUrl).origin;
	} catch {
		return [];
	}
	return FALLBACK_PATHS.slice(0, Math.max(0, Math.floor(maxCandidates))).flatMap((path) => {
		const url = safeCandidate(path, origin);
		return url ? [{ url, title: null, type: 'candidate-path' as const }] : [];
	});
}
