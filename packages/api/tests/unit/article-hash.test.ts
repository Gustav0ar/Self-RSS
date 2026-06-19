import { describe, expect, it } from 'vitest';
import { createArticleContentHash } from '../../src/utils/article-hash.js';

describe('createArticleContentHash', () => {
	const baseArticle = {
		canonicalUrl: 'https://example.com/story',
		title: 'Story',
		author: 'Author',
		excerpt: 'Excerpt',
		contentHtml: '<p>Body</p>',
		contentText: 'Body',
		heroImageUrl: 'https://example.com/hero.jpg',
	};

	it('returns the same hash for the same content fields', () => {
		expect(createArticleContentHash(baseArticle)).toBe(
			createArticleContentHash({ ...baseArticle }),
		);
	});

	it('changes when the article body changes', () => {
		expect(createArticleContentHash(baseArticle)).not.toBe(
			createArticleContentHash({ ...baseArticle, contentHtml: '<p>Updated body</p>' }),
		);
	});

	it('changes when the hero image changes', () => {
		expect(createArticleContentHash(baseArticle)).not.toBe(
			createArticleContentHash({ ...baseArticle, heroImageUrl: 'https://example.com/new.jpg' }),
		);
	});
});
