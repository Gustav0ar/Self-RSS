import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedView } from '../../src/components/articles/feed-view';

const refreshFeed = vi.fn();
const useKeyboardNavMock = vi.fn();
const openWindowMock = vi.fn();
const useInfiniteArticlesMock = vi.fn();
const updatePreferencesMutate = vi.fn();
const markReadMutate = vi.fn();
const warmNextArticlesMock = vi.fn();
let isRefreshingAllFeeds = false;
let hideReadPreference = false;
let defaultSortPreference = 'latest';
let keyboardShortcutsEnabled = true;
let autoMarkReadMode = 'on_navigate';

vi.mock('../../src/hooks/queries', () => ({
	useInfiniteArticles: (params: unknown) => useInfiniteArticlesMock(params),
	useMarkAllRead: () => ({ mutate: vi.fn() }),
	useMarkRead: () => ({ mutate: markReadMutate }),
	usePreferences: () => ({
		data: {
			hideRead: hideReadPreference,
			defaultSort: defaultSortPreference,
			keyboardShortcutsEnabled,
			autoMarkReadMode,
			density: 'comfortable',
		},
	}),
	usePrefetchArticle: () => vi.fn(),
	useWarmNextArticles: () => warmNextArticlesMock,
	useUpdatePreferences: () => ({ mutate: updatePreferencesMutate }),
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
		hideReadPreference = false;
		defaultSortPreference = 'latest';
		keyboardShortcutsEnabled = true;
		autoMarkReadMode = 'on_navigate';
		useInfiniteArticlesMock.mockReturnValue({
			data: {
				pages: [
					{
						data: [
							{ id: 'article-7', feedId: 'feed-42', isRead: false },
							{ id: 'article-8', feedId: 'feed-42', isRead: false },
							{ id: 'article-9', feedId: 'feed-42', isRead: false },
							{ id: 'article-10', feedId: 'feed-42', isRead: false },
							{ id: 'article-11', feedId: 'feed-42', isRead: false },
							{ id: 'article-12', feedId: 'feed-42', isRead: false },
						],
					},
				],
			},
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		});
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

	it('uses the persisted unread-only preference when loading articles', async () => {
		hideReadPreference = true;

		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		await waitFor(() => {
			expect(useInfiniteArticlesMock).toHaveBeenLastCalledWith(
				expect.objectContaining({ unreadOnly: true }),
			);
		});
	});

	it('persists toolbar unread-only changes to preferences', async () => {
		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		fireEvent.click(screen.getByRole('button', { name: 'Unread' }));

		expect(updatePreferencesMutate).toHaveBeenCalledWith({ hideRead: true });
		await waitFor(() => {
			expect(useInfiniteArticlesMock).toHaveBeenLastCalledWith(
				expect.objectContaining({ unreadOnly: true }),
			);
		});
	});

	it('uses the persisted default sort preference when loading articles', async () => {
		defaultSortPreference = 'oldest';

		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		await waitFor(() => {
			expect(useInfiniteArticlesMock).toHaveBeenLastCalledWith(
				expect.objectContaining({ sort: 'oldest' }),
			);
		});
	});

	it('disables keyboard navigation when the preference is off', () => {
		keyboardShortcutsEnabled = false;

		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		expect(useKeyboardNavMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
	});

	it('marks the destination article read when navigating in on-navigate mode', () => {
		const onSelectArticle = vi.fn();
		useKeyboardNavMock.mockImplementation((options: { onSelect: (id: string) => void }) => {
			options.onSelect('article-8');
		});

		render(<FeedView selectedArticleId="article-7" onSelectArticle={onSelectArticle} />);

		expect(markReadMutate).toHaveBeenCalledWith({ articleId: 'article-8', read: true });
		expect(onSelectArticle).toHaveBeenCalledWith('article-8');
	});

	it('does not mark articles read from navigation when auto-mark is disabled', () => {
		const onSelectArticle = vi.fn();
		autoMarkReadMode = 'disabled';
		useKeyboardNavMock.mockImplementation((options: { onSelect: (id: string) => void }) => {
			options.onSelect('article-8');
		});

		render(<FeedView selectedArticleId="article-7" onSelectArticle={onSelectArticle} />);

		expect(markReadMutate).not.toHaveBeenCalled();
		expect(onSelectArticle).toHaveBeenCalledWith('article-8');
	});

	it('leaves on-open auto-marking to the reader pane', () => {
		const onSelectArticle = vi.fn();
		autoMarkReadMode = 'on_open';
		useKeyboardNavMock.mockImplementation((options: { onSelect: (id: string) => void }) => {
			options.onSelect('article-8');
		});

		render(<FeedView selectedArticleId="article-7" onSelectArticle={onSelectArticle} />);

		expect(markReadMutate).not.toHaveBeenCalled();
		expect(onSelectArticle).toHaveBeenCalledWith('article-8');
	});

	it('warms the next five articles after the current selection', async () => {
		render(<FeedView selectedArticleId="article-7" onSelectArticle={() => {}} />);

		await waitFor(() => {
			expect(warmNextArticlesMock).toHaveBeenCalledWith([
				'article-8',
				'article-9',
				'article-10',
				'article-11',
				'article-12',
			]);
		});
	});

	it('warms the first five articles when no article is selected', async () => {
		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		await waitFor(() => {
			expect(warmNextArticlesMock).toHaveBeenCalledWith([
				'article-7',
				'article-8',
				'article-9',
				'article-10',
				'article-11',
			]);
		});
	});
});
