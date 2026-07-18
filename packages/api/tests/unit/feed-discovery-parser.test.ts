import { describe, expect, it } from 'vitest';
import {
	buildFallbackDiscoveryCandidates,
	discoverFeedsFromHtml,
} from '../../src/services/feed-discovery-parser.js';

describe('feed discovery parser', () => {
	it('resolves relative/base URLs, recognizes JSON Feed, and deduplicates exact normalized URLs', () => {
		const candidates = discoverFeedsFromHtml(
			`<html><head><base href="https://cdn.example.com/blog/">
			<link rel="alternate" type="application/rss+xml" href="../rss.xml#top" title="RSS">
			<link rel="alternate stylesheet" type="application/rss+xml" href="https://cdn.example.com/rss.xml">
			<link rel="alternate" type="application/atom+xml" href="atom.xml">
			<link rel="alternate" type="application/feed+json" href="feed.json">
			<link rel="alternate" type="text/html" href="ignored.html">
			<link rel="alternate" type="application/rss+xml" href="javascript:bad()">
			<link rel="alternate" type="application/rss+xml" href="https://user:pass@example.com/private">
			</head></html>`,
			'https://example.com/page',
		);
		expect(candidates).toEqual([
			{ url: 'https://cdn.example.com/rss.xml', title: 'RSS', type: 'rss' },
			{ url: 'https://cdn.example.com/blog/atom.xml', title: null, type: 'atom' },
			{ url: 'https://cdn.example.com/blog/feed.json', title: null, type: 'json-feed' },
		]);
	});

	it('tolerates malformed HTML and enforces the candidate limit', () => {
		const links = Array.from(
			{ length: 10 },
			(_, index) => `<link rel=alternate type=application/rss+xml href="/feed-${index}.xml">`,
		).join('');
		expect(discoverFeedsFromHtml(`<html><head>${links}`, 'https://example.com', 3)).toHaveLength(3);
		expect(discoverFeedsFromHtml('<not even closed', 'not a URL')).toEqual([]);
	});

	it('returns conservative fallback paths as queued candidates without probing', () => {
		const candidates = buildFallbackDiscoveryCandidates('https://Example.COM/articles/one', 2);
		expect(candidates).toEqual([
			{ url: 'https://example.com/feed', title: null, type: 'candidate-path' },
			{ url: 'https://example.com/feed/', title: null, type: 'candidate-path' },
		]);
	});
});
