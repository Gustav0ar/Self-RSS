import { describe, expect, it } from 'vitest';
import { mapNormalizedItemToArticle } from '../../src/services/feed-snapshot-delivery.service.js';
import type { NormalizedFeedItem } from '../../src/services/normalized-feed.types.js';

const item: NormalizedFeedItem = {
	guid: 'item-1',
	canonicalUrl: 'https://example.com/one',
	title: 'One',
	author: 'Ada',
	summary: 'Summary',
	contentHtml: '<p>Body</p>',
	contentText: 'Body',
	media: [
		{
			url: 'https://cdn.example.com/audio.mp3',
			type: 'audio/mpeg',
			medium: 'audio',
			width: null,
			height: null,
			length: 10,
		},
		{
			url: 'https://cdn.example.com/hero.jpg',
			type: 'image/jpeg',
			medium: 'image',
			width: 1200,
			height: 630,
			length: null,
		},
	],
	categories: ['Tech'],
	publishedAt: '2026-07-18T00:00:00.000Z',
	updatedAt: null,
};

describe('normalized delivery mapping', () => {
	it('maps stable article/media hashes and chooses the first image as hero', () => {
		const first = mapNormalizedItemToArticle('feed-1', item, new Date('2026-07-18T01:00:00Z'));
		const repeated = mapNormalizedItemToArticle('feed-1', item, new Date('2026-07-19T01:00:00Z'));
		expect(first.article).toMatchObject({
			feedId: 'feed-1',
			guid: 'item-1',
			heroImageUrl: 'https://cdn.example.com/hero.jpg',
			publishedAt: new Date('2026-07-18T00:00:00Z'),
		});
		expect(first.article.hash).toBe(repeated.article.hash);
		expect(first.media).toMatchObject([
			{ type: 'audio', provider: 'cdn.example.com', position: 0 },
			{ type: 'image', provider: 'cdn.example.com', position: 1 },
		]);
	});

	it('changes the hash when normalized content changes', () => {
		const first = mapNormalizedItemToArticle('feed-1', item).article.hash;
		const changed = mapNormalizedItemToArticle('feed-1', { ...item, contentText: 'Richer body' })
			.article.hash;
		expect(changed).not.toBe(first);
	});
});
