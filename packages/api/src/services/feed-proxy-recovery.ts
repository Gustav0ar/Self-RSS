import type RSSParser from 'rss-parser';
import { readResponseTextWithinLimit } from '../utils/bounded-response.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithValidatedRedirects } from '../utils/safe-fetch.js';

const logger = createLogger();

const STALE_PROXY_FEED_MIN_AGE_MS = 48 * 60 * 60 * 1000;
const STALE_PROXY_REPLACEMENT_MIN_NEWER_MS = 60 * 60 * 1000;
const PROXY_FEED_HOST_SUFFIXES = ['feedburner.com'];
const COMMON_FEED_DISCOVERY_PATHS = [
	'/rss.php',
	'/feed',
	'/feed/',
	'/rss',
	'/rss.xml',
	'/atom.xml',
	'/feed.xml',
];

type FeedItemRecord = Record<string, unknown>;
type ParsedFeed = RSSParser.Output<FeedItemRecord>;

interface FeedProxyRecoveryConfig {
	timeoutMs: number;
	maxContentLength: number;
	allowPrivateHosts: boolean;
}

interface ResolveStaleProxyFeedOptions {
	feedUrl: string;
	parsed: ParsedFeed;
	config: FeedProxyRecoveryConfig;
	fetchAndParse: (feedUrl: string, ignoreCache: boolean) => Promise<ParsedFeed>;
}

export interface ProxyFeedResolution {
	parsed: ParsedFeed;
	feedUrl: string;
	warning: string | null;
}

export function isKnownProxyFeedUrl(feedUrl: string) {
	try {
		const hostname = new URL(feedUrl).hostname.toLowerCase();
		return PROXY_FEED_HOST_SUFFIXES.some(
			(suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
		);
	} catch {
		return false;
	}
}

export async function resolveStaleProxyFeed({
	feedUrl,
	parsed,
	config,
	fetchAndParse,
}: ResolveStaleProxyFeedOptions): Promise<ProxyFeedResolution | null> {
	if (!isKnownProxyFeedUrl(feedUrl)) {
		return null;
	}

	const latestProxyItemAt = getLatestItemPublishedAt(parsed);
	if (!latestProxyItemAt) {
		return null;
	}

	const proxyAgeMs = Date.now() - latestProxyItemAt.getTime();
	if (proxyAgeMs < STALE_PROXY_FEED_MIN_AGE_MS) {
		return null;
	}

	const candidates = await discoverCandidateFeedUrls(feedUrl, parsed, config);
	for (const candidateUrl of candidates) {
		try {
			const candidateParsed = await fetchAndParse(candidateUrl, true);
			const latestCandidateItemAt = getLatestItemPublishedAt(candidateParsed);
			if (
				latestCandidateItemAt &&
				latestCandidateItemAt.getTime() - latestProxyItemAt.getTime() >=
					STALE_PROXY_REPLACEMENT_MIN_NEWER_MS
			) {
				logger.warn('Replacing stale proxy feed URL with fresher direct feed URL', {
					feedUrl,
					candidateUrl,
					latestProxyItemAt: latestProxyItemAt.toISOString(),
					latestCandidateItemAt: latestCandidateItemAt.toISOString(),
				});
				return { parsed: candidateParsed, feedUrl: candidateUrl, warning: null };
			}
		} catch (error) {
			logger.debug('Candidate direct feed did not replace stale proxy feed', {
				feedUrl,
				candidateUrl,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const latestItem = latestProxyItemAt.toISOString();
	return {
		parsed,
		feedUrl,
		warning: `Feed proxy appears stale; latest item is from ${latestItem}`,
	};
}

function getLatestItemPublishedAt(parsed: ParsedFeed) {
	const dates = (parsed.items ?? [])
		.map((item) => parsePublishedAt((item as FeedItemRecord).pubDate))
		.filter((date): date is Date => date != null);
	if (dates.length === 0) {
		return null;
	}
	return dates.reduce((latest, date) => (date > latest ? date : latest));
}

async function discoverCandidateFeedUrls(
	feedUrl: string,
	parsed: ParsedFeed,
	config: FeedProxyRecoveryConfig,
) {
	const siteUrl = normalizeText(parsed.link);
	if (!siteUrl) {
		return [];
	}

	const candidates = new Set<string>();
	const addCandidate = (value: string | null) => {
		if (!value) return;
		try {
			const resolved = new URL(value, siteUrl).toString();
			if (resolved !== feedUrl) {
				candidates.add(resolved);
			}
		} catch {
			// Ignore malformed discovery candidates.
		}
	};

	for (const path of COMMON_FEED_DISCOVERY_PATHS) {
		addCandidate(path);
	}

	for (const alternate of await discoverAlternateFeedUrls(siteUrl, config)) {
		addCandidate(alternate);
	}

	return [...candidates];
}

async function discoverAlternateFeedUrls(siteUrl: string, config: FeedProxyRecoveryConfig) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 5000));

	try {
		const response = await fetchWithValidatedRedirects(
			siteUrl,
			{
				signal: controller.signal,
				headers: {
					'User-Agent': 'SelfFeed/1.0',
					Accept: 'text/html,application/xhtml+xml',
				},
			},
			{ allowPrivateHosts: config.allowPrivateHosts, maxRedirects: 3 },
		);
		if (!response.ok) {
			await response.body?.cancel().catch(() => undefined);
			return [];
		}

		const html = await readResponseTextWithinLimit(
			response,
			Math.min(config.maxContentLength, 1_000_000),
			controller,
		);
		return extractAlternateFeedUrlsFromHtml(html);
	} catch (error) {
		logger.debug('Unable to discover alternate feed links from site HTML', {
			siteUrl,
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	} finally {
		clearTimeout(timeout);
	}
}

function extractAlternateFeedUrlsFromHtml(html: string) {
	const urls: string[] = [];
	const linkTagPattern = /<link\b[^>]*>/gi;
	for (const match of html.matchAll(linkTagPattern)) {
		const tag = match[0];
		const rel = getHtmlAttribute(tag, 'rel')?.toLowerCase() ?? '';
		const type = getHtmlAttribute(tag, 'type')?.toLowerCase() ?? '';
		const href = getHtmlAttribute(tag, 'href');
		if (!href) continue;
		if (!rel.split(/\s+/).includes('alternate')) continue;
		if (
			type.includes('rss') ||
			type.includes('atom') ||
			type.includes('feed') ||
			type.includes('xml')
		) {
			urls.push(href);
		}
	}
	return urls;
}

function getHtmlAttribute(tag: string, name: string) {
	const unquotedValue = '[^\\s"\'=<>`]+';
	const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(${unquotedValue}))`, 'i');
	const match = pattern.exec(tag);
	return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function parsePublishedAt(value: unknown): Date | null {
	const normalized = normalizeText(value);
	if (!normalized) return null;
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeText(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value == null) return null;
	if (typeof value === 'object') {
		const maybeValue = value as { value?: unknown; _: unknown; '#text'?: unknown };
		return normalizeText(maybeValue.value ?? maybeValue._ ?? maybeValue['#text']);
	}
	return null;
}
