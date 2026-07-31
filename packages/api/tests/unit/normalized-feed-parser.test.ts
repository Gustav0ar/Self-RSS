import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	NORMALIZED_FEED_PARSER_VERSION,
	parseNormalizedFeed,
} from '../../src/services/normalized-feed-parser.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/feeds');
const load = (name: string) => readFileSync(resolve(fixtures, name), 'utf8');

describe('parseNormalizedFeed', () => {
	it('normalizes RSS 2.x, preserves date fallbacks, sanitizes content, and deduplicates items', async () => {
		const parsed = await parseNormalizedFeed(load('rss.xml'), {
			finalUrl: 'https://example.com/feed.xml',
		});
		expect(parsed).toMatchObject({
			format: 'rss',
			parserVersion: NORMALIZED_FEED_PARSER_VERSION,
			source: {
				title: 'RSS Fixture',
				feedUrl: 'https://example.com/feed.xml',
				language: 'en-US',
				imageUrl: 'https://example.com/icon.png',
			},
			publisherHints: {
				rssTtlSeconds: 1800,
				syndicationIntervalSeconds: 21600,
				effectiveIntervalSeconds: 21600,
			},
		});
		expect(parsed.items).toHaveLength(2);
		expect(parsed.items[0]).toMatchObject({
			guid: 'rss-1',
			canonicalUrl: 'https://example.com/posts/One',
			author: 'Ada',
			publishedAt: '2025-03-04T05:06:07.000Z',
			categories: ['Tech'],
		});
		expect(parsed.items[0]!.contentHtml).not.toContain('<script');
		expect(parsed.items[0]!.contentHtml).toContain('https://example.com/hero.jpg');
		expect(parsed.items[0]!.media.map((media) => media.url)).toContain(
			'https://cdn.example.com/audio.mp3',
		);
		expect(parsed.items[1]!.publishedAt).toBe('2025-03-05T06:07:08.000Z');
		expect(parsed.items[1]!.guid).toMatch(/^content:[a-f0-9]{64}$/);
		expect(parsed.rawBodyHash).toMatch(/^[a-f0-9]{64}$/);
		expect(parsed.normalizedPayloadHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it.each([
		['rdf.xml', 'rdf', 'RDF Fixture', '2025-04-06T07:08:09.000Z'],
		['atom.xml', 'atom', 'Atom Fixture', '2025-05-02T03:04:05.000Z'],
		['json-feed.json', 'json-feed', 'JSON Fixture', '2025-06-07T08:09:10.000Z'],
	] as const)('normalizes %s', async (fixture, format, title, publishedAt) => {
		const parsed = await parseNormalizedFeed(load(fixture), {
			finalUrl: `https://${format}.example/feed`,
		});
		expect(parsed.format).toBe(format);
		expect(parsed.source.title).toBe(title);
		expect(parsed.items[0]?.publishedAt).toBe(publishedAt);
		expect(parsed.items[0]?.title).toBeTruthy();
	});

	it('normalizes JSON Feed attachments and HTTP publisher hints', async () => {
		const parsed = await parseNormalizedFeed(load('json-feed.json'), {
			finalUrl: 'https://json.example/feed.json',
			responseHeaders: new Headers({
				'cache-control': 'public, max-age=7200, s-maxage=10800',
				expires: 'Fri, 18 Jul 2026 04:00:00 GMT',
			}),
			now: new Date('2026-07-18T00:00:00Z'),
		});
		expect(parsed.publisherHints).toMatchObject({
			httpMaxAgeSeconds: 10800,
			httpExpiresSeconds: 14400,
			effectiveIntervalSeconds: 14400,
		});
		expect(parsed.items[0]?.media[0]).toMatchObject({
			url: 'https://json.example/video.mp4',
			type: 'video/mp4',
			length: 456,
		});
	});

	it.each([
		['<html><body>not a feed</body></html>', 'unsupported_feed'],
		['plain garbage', 'unsupported_feed'],
		['{"hello":"world"}', 'unsupported_feed'],
		['{"version":"https://jsonfeed.org/version/2","items":[]}', 'unsupported_feed'],
		['{"version":"https://jsonfeed.org/version/1.1",', 'invalid_feed'],
	])('rejects non-feed or malformed input', async (raw, code) => {
		await expect(parseNormalizedFeed(raw)).rejects.toMatchObject({ code });
	});

	it('rejects oversized normalized output and nulls malformed dates/URLs', async () => {
		const raw = JSON.stringify({
			version: 'https://jsonfeed.org/version/1.1',
			title: 'Bounded',
			items: [
				{
					id: 'one',
					url: 'javascript:bad()',
					date_published: 'not-a-date',
					content_text: 'x'.repeat(500),
				},
			],
		});
		await expect(parseNormalizedFeed(raw, { maxNormalizedBytes: 100 })).rejects.toMatchObject({
			code: 'normalized_payload_too_large',
		});
		const parsed = await parseNormalizedFeed(raw);
		expect(parsed.items[0]).toMatchObject({ canonicalUrl: null, publishedAt: null });
	});
});
