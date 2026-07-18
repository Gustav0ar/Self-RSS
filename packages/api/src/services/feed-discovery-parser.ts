import { JSDOM, VirtualConsole } from 'jsdom';
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

function safeCandidate(raw: string, base: string) {
	try {
		return normalizeFeedSourceUrl(new URL(raw, base).toString()).normalizedUrl;
	} catch {
		return null;
	}
}

export function discoverFeedsFromHtml(
	html: string,
	finalPageUrl: string,
	maxCandidates = 20,
): FeedDiscoveryCandidate[] {
	const limit = Math.max(0, Math.floor(maxCandidates));
	if (limit === 0) return [];
	let dom: JSDOM;
	try {
		dom = new JSDOM(html, { url: finalPageUrl, virtualConsole: new VirtualConsole() });
	} catch {
		return [];
	}
	try {
		const candidates = new Map<string, FeedDiscoveryCandidate>();
		for (const link of dom.window.document.querySelectorAll('link[rel][href]')) {
			if (candidates.size >= limit) break;
			const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
			if (!rel.includes('alternate')) continue;
			const rawType = (link.getAttribute('type') ?? '').toLowerCase().split(';')[0]!.trim();
			const type = FEED_TYPES.get(rawType);
			if (!type) continue;
			const resolved = safeCandidate(link.getAttribute('href') ?? '', link.baseURI);
			if (!resolved || candidates.has(resolved)) continue;
			candidates.set(resolved, {
				url: resolved,
				title: link.getAttribute('title')?.trim() || null,
				type,
			});
		}
		return [...candidates.values()];
	} finally {
		dom.window.close();
	}
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
