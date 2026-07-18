import { createHash } from 'node:crypto';
import RSSParser from 'rss-parser';
import { resolvePublisherHtmlUrls, resolvePublisherUrl } from '../utils/publisher-url.js';
import {
	extractExcerpt,
	extractMediaFromHtml,
	sanitizeHtml,
	stripHtml,
} from '../utils/sanitizer.js';
import { extractPublisherScheduleHints } from './feed-publisher-hints.js';
import type {
	NormalizedFeedItem,
	NormalizedFeedMedia,
	NormalizedFeedPayload,
} from './normalized-feed.types.js';

export const NORMALIZED_FEED_PARSER_VERSION = 'self-feed-normalized/1';
const DEFAULT_MAX_NORMALIZED_BYTES = 5 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;

export class NormalizedFeedParseError extends Error {
	constructor(
		message: string,
		readonly code: 'invalid_feed' | 'unsupported_feed' | 'normalized_payload_too_large',
	) {
		super(message);
		this.name = 'NormalizedFeedParseError';
	}
}

function hash(value: string) {
	return createHash('sha256').update(value).digest('hex');
}

function record(value: unknown): UnknownRecord {
	return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function text(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === 'string') return value.trim() || null;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ') || null;
	const item = record(value);
	const nested = item._ ?? item['#text'] ?? item.value ?? item.name;
	return nested === value ? null : text(nested);
}

function date(value: unknown): string | null {
	const raw = text(value);
	if (!raw) return null;
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function strings(value: unknown): string[] {
	const values = Array.isArray(value) ? value : value == null ? [] : [value];
	return [...new Set(values.map(text).filter((item): item is string => Boolean(item)))];
}

function number(value: unknown): number | null {
	const parsed = Number(text(value));
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function mediaFromValue(value: unknown, bases: string[]): NormalizedFeedMedia[] {
	const values = Array.isArray(value) ? value : value == null ? [] : [value];
	return values.flatMap((entry) => {
		const item = record(entry);
		const attributes = { ...item, ...record(item.$) };
		const url = resolvePublisherUrl(attributes.url ?? attributes.href, ...bases);
		if (!url) return [];
		return [
			{
				url,
				type: text(attributes.type ?? attributes.mime_type),
				medium: text(attributes.medium),
				width: number(attributes.width),
				height: number(attributes.height),
				length: number(attributes.length ?? attributes.fileSize ?? attributes.size_in_bytes),
			},
		];
	});
}

function normalizeMedia(item: UnknownRecord, contentHtml: string | null, bases: string[]) {
	const candidates = [
		...mediaFromValue(item.enclosure, bases),
		...mediaFromValue(item.attachments, bases),
		...mediaFromValue(item['media:content'], bases),
		...mediaFromValue(item['media:thumbnail'], bases),
	];
	if (contentHtml) {
		for (const extracted of extractMediaFromHtml(contentHtml)) {
			const url = resolvePublisherUrl(extracted.url, ...bases);
			if (url) {
				candidates.push({
					url,
					type: extracted.type,
					medium: extracted.type,
					width: extracted.width,
					height: extracted.height,
					length: null,
				});
			}
		}
	}
	return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
}

function normalizeItem(
	item: UnknownRecord,
	index: number,
	feedUrl: string | null,
): NormalizedFeedItem {
	const siteUrl = text(item.feedSiteUrl);
	const canonicalUrl = resolvePublisherUrl(
		item.url ?? item.external_url ?? item.link,
		siteUrl,
		feedUrl,
	);
	const bases = [canonicalUrl, siteUrl, feedUrl].filter((value): value is string => Boolean(value));
	const rawHtml = text(
		item.content_html ??
			item['content:encoded'] ??
			item.content ??
			item.summary ??
			item.description,
	);
	const contentHtml = rawHtml
		? resolvePublisherHtmlUrls(sanitizeHtml(rawHtml), ...bases) || null
		: null;
	const contentText =
		text(item.content_text) ??
		(contentHtml ? stripHtml(contentHtml) || null : text(item.contentSnippet));
	const summaryText = text(item.summary ?? item.description ?? item.contentSnippet);
	const summary = summaryText
		? extractExcerpt(stripHtml(sanitizeHtml(summaryText)))
		: contentText
			? extractExcerpt(contentText)
			: null;
	const publishedAt = date(
		item.date_published ??
			item.isoDate ??
			item.pubDate ??
			item.date ??
			item['dc:date'] ??
			item.published,
	);
	const updatedAt = date(item.date_modified ?? item.updated ?? item.modified);
	const title = text(item.title) ?? 'Untitled';
	const author = text(
		item.author ?? item.authors ?? item.creator ?? item['dc:creator'] ?? record(item.author).name,
	);
	const fallbackMaterial = JSON.stringify({ title, publishedAt, updatedAt, contentText, summary });
	const guid =
		text(item.id ?? item.guid) ??
		canonicalUrl ??
		`content:${hash(fallbackMaterial || String(index))}`;
	return {
		guid,
		canonicalUrl,
		title,
		author,
		summary,
		contentHtml,
		contentText,
		media: normalizeMedia(item, contentHtml, bases),
		categories: strings(item.tags ?? item.categories ?? item.category),
		publishedAt,
		updatedAt,
	};
}

function detectXmlFormat(raw: string): 'rss' | 'rdf' | 'atom' {
	if (/<(?:\w+:)?rdf\b/i.test(raw)) return 'rdf';
	if (/<feed\b[^>]*(?:xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom|>)/i.test(raw)) {
		return 'atom';
	}
	if (/<rss\b/i.test(raw)) return 'rss';
	throw new NormalizedFeedParseError('Document is not a supported XML feed', 'unsupported_feed');
}

function normalizeJsonFeed(raw: string) {
	let parsed: UnknownRecord;
	try {
		parsed = JSON.parse(raw) as UnknownRecord;
	} catch {
		throw new NormalizedFeedParseError('JSON Feed is malformed', 'invalid_feed');
	}
	const version = text(parsed.version);
	if (
		version !== 'https://jsonfeed.org/version/1' &&
		version !== 'https://jsonfeed.org/version/1.1'
	) {
		throw new NormalizedFeedParseError('JSON document is not a JSON Feed', 'unsupported_feed');
	}
	return parsed;
}

function sourceImage(value: unknown, ...bases: Array<string | null>) {
	const image = record(value);
	return resolvePublisherUrl(text(image.url ?? value), ...bases);
}

export async function parseNormalizedFeed(
	rawBody: string,
	options: {
		finalUrl?: string;
		responseHeaders?: Headers | Record<string, string | null | undefined>;
		maxNormalizedBytes?: number;
		now?: Date;
	} = {},
): Promise<NormalizedFeedPayload> {
	const trimmed = rawBody.trim();
	if (!trimmed) throw new NormalizedFeedParseError('Feed body is empty', 'invalid_feed');
	const isJson = trimmed.startsWith('{');
	const format: NormalizedFeedPayload['format'] = isJson ? 'json-feed' : detectXmlFormat(trimmed);
	let feed: UnknownRecord;
	if (isJson) {
		feed = normalizeJsonFeed(trimmed);
	} else {
		try {
			feed = (await new RSSParser({
				customFields: {
					feed: [
						'ttl',
						'language',
						'image',
						'sy:updatePeriod',
						'sy:updateFrequency',
						'sy:updateBase',
					],
					item: [
						'date',
						'dc:date',
						'dc:creator',
						'content:encoded',
						['media:content', 'media:content', { keepArray: true }],
						['media:thumbnail', 'media:thumbnail', { keepArray: true }],
					],
				},
			}).parseString(trimmed)) as unknown as UnknownRecord;
		} catch {
			throw new NormalizedFeedParseError('XML feed is malformed', 'invalid_feed');
		}
	}

	const siteUrl = resolvePublisherUrl(feed.home_page_url ?? feed.link, options.finalUrl);
	const feedUrl =
		resolvePublisherUrl(feed.feed_url ?? feed.feedUrl, options.finalUrl) ??
		options.finalUrl ??
		null;
	const source = {
		title: text(feed.title),
		siteUrl,
		description: text(feed.description ?? feed.subtitle),
		language: text(feed.language),
		imageUrl: sourceImage(feed.icon ?? feed.favicon ?? feed.image, siteUrl, feedUrl),
	};
	const rawItems = Array.isArray(feed.items) ? feed.items : [];
	const items = [
		...new Map(
			rawItems.map((item, index) => {
				const withBase = { ...record(item), feedSiteUrl: siteUrl };
				const normalized = normalizeItem(withBase, index, feedUrl);
				return [normalized.guid, normalized] as const;
			}),
		).values(),
	];
	if (items.length === 0 && !source.title && !siteUrl) {
		throw new NormalizedFeedParseError(
			'Document contains no feed metadata or items',
			'invalid_feed',
		);
	}

	const rawBodyHash = hash(rawBody);
	const basePayload = {
		format,
		parserVersion: NORMALIZED_FEED_PARSER_VERSION,
		rawBodyHash,
		source,
		items,
		publisherHints: extractPublisherScheduleHints(feed, options.responseHeaders, options.now),
	};
	const normalizedJson = JSON.stringify(basePayload);
	const payload = { ...basePayload, normalizedPayloadHash: hash(normalizedJson) };
	if (
		Buffer.byteLength(JSON.stringify(payload)) >
		(options.maxNormalizedBytes ?? DEFAULT_MAX_NORMALIZED_BYTES)
	) {
		throw new NormalizedFeedParseError(
			'Normalized feed payload exceeds the configured size limit',
			'normalized_payload_too_large',
		);
	}
	return payload;
}
