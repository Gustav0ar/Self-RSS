import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedView } from '../../src/components/articles/feed-view';

const onSelectArticle = vi.fn();
let currentResult: {
	data: { pages: Array<{ data: unknown[]; hasMore: boolean; cursor: null }> } | undefined;
	isFetching: boolean;
	isFetchingNextPage: boolean;
	isLoading: boolean;
	fetchNextPage: () => void;
	hasNextPage: boolean;
} = {
	data: undefined,
	isFetching: false,
	isFetchingNextPage: false,
	isLoading: true,
	fetchNextPage: vi.fn(),
	hasNextPage: false,
};
const categories = [
	{
		id: 'category-1',
		userId: 'user-1',
		parentCategoryId: null,
		name: 'Review Feeds',
		slug: 'review-feeds',
		sortOrder: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		feedCount: 1,
		unreadCount: 0,
		feeds: [],
		children: [],
	},
];

vi.mock('../../src/hooks/queries', () => ({
	useCategories: () => ({ data: categories }),
	useInfiniteArticles: () => currentResult,
	useArticle: () => ({ data: null, isLoading: false }),
	useEnrichArticle: () => ({ mutate: vi.fn(), isPending: false }),
	useMarkAllRead: () => ({ mutate: vi.fn() }),
	useMarkRead: () => ({ mutate: vi.fn() }),
	usePreferences: () => ({
		data: {
			hideRead: false,
			defaultSort: 'latest',
			keyboardShortcutsEnabled: false,
			autoMarkReadMode: 'on_navigate',
			density: 'comfortable',
			fontFamily: 'Inter',
			textSize: 16,
		},
	}),
	useUpdatePreferences: () => ({ mutate: vi.fn() }),
	usePrefetchArticle: () => vi.fn(),
	useWarmNextArticles: () => vi.fn(),
}));

vi.mock('../../src/hooks/use-feed-refresh', () => ({
	useFeedRefresh: () => ({
		allFeedsSyncStatus: null,
		isRefreshingAllFeeds: false,
		isRefreshingFeed: () => false,
		refreshFeed: vi.fn(),
	}),
}));

vi.mock('../../src/hooks/use-keyboard-nav', () => ({
	useKeyboardNav: vi.fn(),
}));

vi.mock('../../src/hooks/use-silent-article-refresh', () => ({
	useSilentArticleRefresh: vi.fn(),
}));

vi.mock('@/providers/app-state', () => ({
	useAppState: () => ({
		feedSyncError: null,
	}),
}));

vi.mock('@/providers/auth', () => ({
	useAuth: () => ({}),
}));

vi.mock('@/hooks/use-read-state-sync', () => ({
	useReadStateSync: vi.fn(),
}));

describe('FeedView selected article sync', () => {
	it('clears the active article when the article is not in the loaded list (list view)', () => {
		currentResult = {
			data: { pages: [{ data: [], hasMore: false, cursor: null }] },
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		};
		onSelectArticle.mockClear();
		render(<FeedView selectedArticleId="article-orphan" onSelectArticle={onSelectArticle} />);
		expect(onSelectArticle).toHaveBeenCalledWith(null);
	});

	it('keeps the active article when it is in the loaded list', () => {
		currentResult = {
			data: {
				pages: [
					{
						data: [
							{ id: 'article-1', isRead: false },
							{ id: 'article-2', isRead: false },
						],
						hasMore: false,
						cursor: null,
					},
				],
			},
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		};
		onSelectArticle.mockClear();
		render(<FeedView selectedArticleId="article-1" onSelectArticle={onSelectArticle} />);
		expect(onSelectArticle).not.toHaveBeenCalled();
	});

	it('does not clear the active article while the list is still loading', () => {
		currentResult = {
			data: undefined,
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: true,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		};
		onSelectArticle.mockClear();
		render(<FeedView selectedArticleId="article-orphan" onSelectArticle={onSelectArticle} />);
		expect(onSelectArticle).not.toHaveBeenCalled();
	});

	it('preserves a deep-linked article even when the list is empty', () => {
		currentResult = {
			data: { pages: [{ data: [], hasMore: false, cursor: null }] },
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		};
		onSelectArticle.mockClear();
		render(
			<FeedView
				selectedArticleId="article-orphan"
				fromDeepLink
				onSelectArticle={onSelectArticle}
			/>,
		);
		expect(onSelectArticle).not.toHaveBeenCalled();
	});
});
