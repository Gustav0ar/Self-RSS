import type { ApiListResponse, ArticleListItem, CategoryWithCounts } from '@self-feed/shared';
import { describe, expect, it } from 'vitest';
import {
	buildEmptyState,
	buildFeedViewModel,
	dedupeArticlePages,
	mergeRetainedReadArticles,
	type RetainedReadArticle,
	resolveEffectiveArticleId,
} from '../../src/components/articles/feed-view-model';

function article(id: string, feedId = 'feed-1', isRead = false): ArticleListItem {
	return {
		id,
		feedId,
		feedTitle: `Feed ${feedId}`,
		feedFaviconUrl: null,
		title: `Article ${id}`,
		author: null,
		excerpt: null,
		heroImageUrl: null,
		publishedAt: null,
		displayedAt: '2026-06-01T00:00:00.000Z',
		isRead,
	};
}

function page(items: ArticleListItem[]): ApiListResponse<ArticleListItem> {
	return { data: items, cursor: null, hasMore: false };
}

const categoryTree: CategoryWithCounts[] = [
	{
		id: 'parent-category',
		userId: 'user-1',
		parentCategoryId: null,
		name: 'Parent',
		slug: 'parent',
		sortOrder: 0,
		createdAt: '2026-06-01T00:00:00.000Z',
		updatedAt: '2026-06-01T00:00:00.000Z',
		feedCount: 1,
		unreadCount: 7,
		feeds: [
			{
				id: 'feed-1',
				userId: 'user-1',
				categoryId: 'parent-category',
				title: 'Parent Feed',
				siteUrl: null,
				feedUrl: 'https://example.com/feed.xml',
				faviconUrl: null,
				description: null,
				pollingIntervalMinutes: 60,
				lastSyncedAt: null,
				syncStatus: 'idle',
				createdAt: '2026-06-01T00:00:00.000Z',
				updatedAt: '2026-06-01T00:00:00.000Z',
				unreadCount: 4,
			},
		],
		children: [
			{
				id: 'child-category',
				userId: 'user-1',
				parentCategoryId: 'parent-category',
				name: 'Child',
				slug: 'child',
				sortOrder: 1,
				createdAt: '2026-06-01T00:00:00.000Z',
				updatedAt: '2026-06-01T00:00:00.000Z',
				feedCount: 1,
				unreadCount: 3,
				feeds: [
					{
						id: 'feed-2',
						userId: 'user-1',
						categoryId: 'child-category',
						title: 'Child Feed',
						siteUrl: null,
						feedUrl: 'https://example.com/child.xml',
						faviconUrl: null,
						description: null,
						pollingIntervalMinutes: 60,
						lastSyncedAt: null,
						syncStatus: 'idle',
						createdAt: '2026-06-01T00:00:00.000Z',
						updatedAt: '2026-06-01T00:00:00.000Z',
						unreadCount: 3,
					},
				],
				children: [],
			},
		],
	},
];

describe('feed view model helpers', () => {
	it('deduplicates article pages while preserving the first occurrence order', () => {
		const articles = dedupeArticlePages([
			page([article('article-1'), article('article-2')]),
			page([article('article-2'), article('article-3')]),
		]);

		expect(articles.map((item) => item.id)).toEqual(['article-1', 'article-2', 'article-3']);
	});

	it('derives feed and category labels with unread counts from the category tree', () => {
		expect(
			buildFeedViewModel({
				categoryTree,
				feedId: 'feed-2',
				feedSyncError: null,
				unreadOnly: false,
			}),
		).toMatchObject({ viewTitle: 'Child Feed', scopeUnreadCount: 3 });

		expect(
			buildFeedViewModel({
				categoryTree,
				categoryId: 'child-category',
				feedSyncError: null,
				unreadOnly: false,
			}),
		).toMatchObject({ viewTitle: 'Parent / Child', scopeUnreadCount: 3 });
	});

	it('keeps read articles in their previous slots while an unread-only list refreshes', () => {
		const retained = new Map<string, RetainedReadArticle>([
			['article-2', { article: article('article-2', 'feed-1', true), index: 1 }],
			['article-4', { article: article('article-4', 'feed-1', true), index: 10 }],
		]);

		const merged = mergeRetainedReadArticles(
			[article('article-1'), article('article-3')],
			retained,
			true,
		);

		expect(merged.map((item) => item.id)).toEqual([
			'article-1',
			'article-2',
			'article-3',
			'article-4',
		]);
		expect(mergeRetainedReadArticles([article('article-1')], retained, false)).toEqual([
			article('article-1'),
		]);
	});

	it('preserves deep-linked article ids even when the loaded list does not contain them', () => {
		const articleIds = new Set(['article-1']);

		expect(
			resolveEffectiveArticleId({
				articleIds,
				fromDeepLink: false,
				selectedArticleId: 'article-orphan',
			}),
		).toBeNull();
		expect(
			resolveEffectiveArticleId({
				articleIds,
				fromDeepLink: true,
				selectedArticleId: 'article-orphan',
			}),
		).toBe('article-orphan');
	});

	it('prioritizes sync errors over scope-specific empty-state copy', () => {
		expect(
			buildEmptyState({
				feedId: 'feed-1',
				feedSyncError: 'Fetch failed',
				unreadOnly: true,
			}),
		).toEqual({
			title: 'Unable to refresh articles',
			description: 'Fetch failed',
		});
	});
});
