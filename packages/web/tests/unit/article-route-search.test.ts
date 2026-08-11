import { describe, expect, it } from 'vitest';
import {
	buildArticleRouteSearch,
	validateArticleRouteSearch,
} from '../../src/routes/article-route-search';

describe('article route search', () => {
	it('keeps Saved as an exclusive top-level article scope', () => {
		expect(
			buildArticleRouteSearch({
				feedId: 'feed-1',
				categoryId: 'category-1',
				savedOnly: true,
			}),
		).toEqual({ savedOnly: true });
	});

	it('accepts serialized saved links', () => {
		expect(validateArticleRouteSearch({ savedOnly: 'true' })).toEqual({ savedOnly: true });
	});
});
