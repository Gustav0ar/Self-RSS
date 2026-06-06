import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedView } from '../../src/components/articles/feed-view';

const refreshFeed = vi.fn();
const useKeyboardNavMock = vi.fn();
const openWindowMock = vi.fn();
let isRefreshingAllFeeds = false;

vi.mock('../../src/hooks/queries', () => ({
	useInfiniteArticles: () => ({
		data: {
			pages: [
				{
					data: [{ id: 'article-7', isRead: false }],
				},
			],
		},
		isFetching: false,
		isFetchingNextPage: false,
		isLoading: false,
		fetchNextPage: vi.fn(),
		hasNextPage: false,
	}),
	useMarkAllRead: () => ({ mutate: vi.fn() }),
	useMarkRead: () => ({ mutate: vi.fn() }),
	usePrefetchArticle: () => vi.fn(),
}));

vi.mock('../../src/hooks/use-feed-refresh', () => ({
	useFeedRefresh: () => ({
		allFeedsSyncStatus: {
			queued: false,
			running: isRefreshingAllFeeds,
			active: isRefreshingAllFeeds,
		},
		feedSyncError: null,
		isRefreshingAllFeeds,
		isRefreshingFeed: () => false,
		refreshFeed,
	}),
}));

vi.mock('../../src/hooks/use-keyboard-nav', () => ({
	useKeyboardNav: (...args: unknown[]) => useKeyboardNavMock(...args),
}));

vi.mock('../../src/components/articles/article-list', () => ({
	ArticleList: () => <div>Article list</div>,
}));

vi.mock('../../src/components/articles/reader-pane', () => ({
	ReaderPane: () => <div>Reader pane</div>,
}));

vi.mock('../../src/providers/app-state', () => ({
	useAppState: () => ({
		feedSyncError: null,
	}),
}));

describe('FeedView refresh', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isRefreshingAllFeeds = false;
		useKeyboardNavMock.mockImplementation(() => undefined);
		vi.stubGlobal('open', openWindowMock);
	});

	it('allows refreshing when the All Feeds view is selected', () => {
		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		const refreshButton = screen.getByRole('button', { name: 'Refresh' });
		expect((refreshButton as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(refreshButton);
		expect(refreshFeed).toHaveBeenCalledWith(undefined, { force: true });
	});

	it('allows refreshing for category views', () => {
		render(
			<FeedView categoryId="category-1" selectedArticleId={null} onSelectArticle={() => {}} />,
		);

		const refreshButton = screen.getByRole('button', { name: 'Refresh' });
		expect((refreshButton as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(refreshButton);
		expect(refreshFeed).toHaveBeenCalledWith(undefined, { force: true });
	});

	it('shows refresh progress while all feeds are syncing in the background', () => {
		isRefreshingAllFeeds = true;

		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		expect(screen.getByText('Loading new articles')).toBeTruthy();
		expect(screen.getByText('Checking feeds and pulling in new stories')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(screen.getByText('Article list')).toBeTruthy();
	});

	it('opens article URLs with the active feed context in a new tab', () => {
		useKeyboardNavMock.mockImplementation((options: { onOpenExternal?: (id: string) => void }) => {
			options.onOpenExternal?.('article-7');
		});

		render(<FeedView feedId="feed-42" selectedArticleId="article-7" onSelectArticle={() => {}} />);

		expect(openWindowMock).toHaveBeenCalledWith(
			'/articles/article-7?feedId=feed-42',
			'_blank',
			'noopener,noreferrer',
		);
	});
});
