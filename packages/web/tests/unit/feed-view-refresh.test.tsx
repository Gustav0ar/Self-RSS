import type { CategoryWithCounts } from '@self-feed/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedView } from '../../src/components/articles/feed-view';

const refreshFeed = vi.fn();
const useKeyboardNavMock = vi.fn();
const openWindowMock = vi.fn();
const useInfiniteArticlesMock = vi.fn();
const updatePreferencesMutate = vi.fn();
const markReadMutate = vi.fn();
const markAllReadMutateAsync = vi.fn();
const warmNextArticlesMock = vi.fn();
let articleListProps: {
	articles: Array<{ id: string; isRead: boolean }>;
	onSelect: (id: string) => void;
} | null = null;
let isRefreshingAllFeeds = false;
let allFeedsRefreshIsTakingLonger = false;
let allFeedsRefreshShouldShowStatus = false;
let hideReadPreference = false;
let defaultSortPreference = 'latest';
let keyboardShortcutsEnabled = true;
let autoMarkReadMode = 'on_navigate';
let preferencesLoaded = true;
const categories: CategoryWithCounts[] = [
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
		unreadCount: 6,
		feeds: [
			{
				id: 'feed-42',
				userId: 'user-1',
				categoryId: 'category-1',
				title: 'Feed 42',
				siteUrl: null,
				feedUrl: 'https://example.com/feed.xml',
				faviconUrl: null,
				description: null,
				pollingIntervalMinutes: 60,
				lastSyncedAt: null,
				syncStatus: 'idle',
				lastSyncError: null,
				lastSyncErrorAt: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				unreadCount: 6,
			},
		],
		children: [],
	},
];

function reviewFeed() {
	const feed = categories[0]?.feeds?.[0];
	if (!feed) throw new Error('Review feed fixture is missing');
	return feed;
}

vi.mock('../../src/hooks/queries', () => ({
	useCategories: () => ({ data: categories }),
	useInfiniteArticles: (...args: unknown[]) => useInfiniteArticlesMock(...args),
	useSearch: () => ({ data: undefined }),
	useMarkAllRead: () => ({
		mutateAsync: markAllReadMutateAsync,
		isPending: false,
	}),
	useMarkRead: () => ({ mutate: markReadMutate }),
	usePreferences: () => ({
		data: preferencesLoaded
			? {
					hideRead: hideReadPreference,
					defaultSort: defaultSortPreference,
					keyboardShortcutsEnabled,
					autoMarkReadMode,
					density: 'comfortable',
				}
			: undefined,
	}),
	usePrefetchArticle: () => vi.fn(),
	useWarmNextArticles: () => warmNextArticlesMock,
	useWarmVisibleArticles: () => vi.fn(),
	useUpdatePreferences: () => ({ mutate: updatePreferencesMutate }),
	useSelectFeedDiscoveryCandidate: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useCancelFeedReplacement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../src/hooks/use-feed-refresh', () => ({
	useFeedRefresh: () => ({
		allFeedsRefreshActivity: {
			phase: allFeedsRefreshIsTakingLonger
				? 'background'
				: isRefreshingAllFeeds
					? 'syncing'
					: 'idle',
			isActive: isRefreshingAllFeeds || allFeedsRefreshIsTakingLonger,
			isBlocking: isRefreshingAllFeeds,
			isTakingLonger: allFeedsRefreshIsTakingLonger,
			shouldShowStatus: isRefreshingAllFeeds || allFeedsRefreshShouldShowStatus,
			activeSinceMs: null,
			elapsedMs: null,
		},
		allFeedsSyncStatus: {
			queued: false,
			running: isRefreshingAllFeeds || allFeedsRefreshIsTakingLonger,
			active: isRefreshingAllFeeds || allFeedsRefreshIsTakingLonger,
		},
		feedSyncError: null,
		isRefreshingAllFeeds,
		isRefreshingFeed: () => false,
		isRefreshBlockedByActiveRequest: () => isRefreshingAllFeeds,
		refreshFeed,
	}),
}));

vi.mock('../../src/hooks/use-keyboard-nav', () => ({
	useKeyboardNav: (...args: unknown[]) => useKeyboardNavMock(...args),
}));

vi.mock('../../src/hooks/use-silent-article-refresh', () => ({
	useSilentArticleRefresh: () => {},
}));

vi.mock('../../src/components/articles/article-list', () => ({
	ArticleList: (props: {
		articles: Array<{ id: string; isRead: boolean }>;
		onSelect: (id: string) => void;
	}) => {
		articleListProps = props;
		return <div>Article list</div>;
	},
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
		markAllReadMutateAsync.mockReset();
		markAllReadMutateAsync.mockResolvedValue({ data: { markedRead: 6 } });
		isRefreshingAllFeeds = false;
		allFeedsRefreshIsTakingLonger = false;
		allFeedsRefreshShouldShowStatus = false;
		hideReadPreference = false;
		defaultSortPreference = 'latest';
		keyboardShortcutsEnabled = true;
		autoMarkReadMode = 'on_navigate';
		preferencesLoaded = true;
		reviewFeed().syncStatus = 'idle';
		reviewFeed().lastSyncError = null;
		reviewFeed().lastSyncErrorAt = null;
		articleListProps = null;
		useInfiniteArticlesMock.mockReturnValue({
			data: {
				pages: [
					{
						data: [
							{
								id: 'article-7',
								feedId: 'feed-42',
								displayedAt: '2026-06-01T12:00:00.000Z',
								isRead: false,
							},
							{
								id: 'article-8',
								feedId: 'feed-42',
								displayedAt: '2026-06-01T11:00:00.000Z',
								isRead: false,
							},
							{
								id: 'article-9',
								feedId: 'feed-42',
								displayedAt: '2026-06-01T10:00:00.000Z',
								isRead: false,
							},
							{
								id: 'article-10',
								feedId: 'feed-42',
								displayedAt: '2026-06-01T09:00:00.000Z',
								isRead: false,
							},
							{
								id: 'article-11',
								feedId: 'feed-42',
								displayedAt: '2026-06-01T08:00:00.000Z',
								isRead: false,
							},
							{
								id: 'article-12',
								feedId: 'feed-42',
								displayedAt: '2026-06-01T07:00:00.000Z',
								isRead: false,
							},
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
		expect(refreshFeed).toHaveBeenCalledWith(undefined, { force: true, categoryId: undefined });
	});

	it.each([
		{
			label: 'all feeds',
			scope: {},
			description: 'Mark 6 unread articles in all feeds as read?',
		},
		{
			label: 'a category',
			scope: { categoryId: 'category-1' },
			description: 'Mark 6 unread articles in category “Review Feeds” as read?',
		},
		{
			label: 'a feed',
			scope: { feedId: 'feed-42' },
			description: 'Mark 6 unread articles in feed “Feed 42” as read?',
		},
	])('describes the exact $label scope before marking articles read', ({ scope, description }) => {
		render(<FeedView {...scope} selectedArticleId={null} onSelectArticle={() => {}} />);

		fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

		const dialog = screen.getByRole('dialog', { name: 'Mark all as read?' });
		expect(within(dialog).getByText(description)).toBeTruthy();
		expect(markAllReadMutateAsync).not.toHaveBeenCalled();
	});

	it('cancels without a request or retained-read reset, then resets only after success', async () => {
		hideReadPreference = true;
		useInfiniteArticlesMock.mockReturnValue({
			data: {
				pages: [
					{
						data: [{ id: 'article-7', feedId: 'feed-42', isRead: false }],
					},
				],
			},
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		});
		const view = render(
			<FeedView feedId="feed-42" selectedArticleId={null} onSelectArticle={() => {}} />,
		);

		articleListProps?.onSelect('article-7');
		useInfiniteArticlesMock.mockReturnValue({
			data: { pages: [{ data: [] }] },
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		});
		view.rerender(
			<FeedView feedId="feed-42" selectedArticleId="article-7" onSelectArticle={() => {}} />,
		);
		await waitFor(() => {
			expect(articleListProps?.articles).toEqual([
				expect.objectContaining({ id: 'article-7', isRead: true }),
			]);
		});

		fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
		expect(articleListProps?.articles).toEqual([
			expect.objectContaining({ id: 'article-7', isRead: true }),
		]);
		fireEvent.click(
			within(screen.getByRole('dialog', { name: 'Mark all as read?' })).getByRole('button', {
				name: 'Cancel',
			}),
		);

		expect(markAllReadMutateAsync).not.toHaveBeenCalled();
		expect(screen.queryByRole('dialog', { name: 'Mark all as read?' })).toBeNull();
		expect(articleListProps?.articles).toEqual([
			expect.objectContaining({ id: 'article-7', isRead: true }),
		]);

		fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
		fireEvent.click(
			within(screen.getByRole('dialog', { name: 'Mark all as read?' })).getByRole('button', {
				name: 'Mark all read',
			}),
		);

		await waitFor(() => {
			expect(markAllReadMutateAsync).toHaveBeenCalledWith({
				feedId: 'feed-42',
				categoryId: undefined,
			});
			expect(screen.queryByRole('dialog', { name: 'Mark all as read?' })).toBeNull();
			expect(articleListProps?.articles).toEqual([]);
		});
	});

	it('prevents repeat confirmation while the mark-all request is pending', async () => {
		let resolveMutation: ((value: { data: { markedRead: number } }) => void) | undefined;
		markAllReadMutateAsync.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveMutation = resolve;
				}),
		);
		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
		const dialog = screen.getByRole('dialog', { name: 'Mark all as read?' });
		fireEvent.click(within(dialog).getByRole('button', { name: 'Mark all read' }));

		await waitFor(() => {
			expect(markAllReadMutateAsync).toHaveBeenCalledTimes(1);
			expect(
				within(dialog).getByRole('button', { name: 'Working...' }) as HTMLButtonElement,
			).toHaveProperty('disabled', true);
		});
		fireEvent.click(within(dialog).getByRole('button', { name: 'Working...' }));
		expect(markAllReadMutateAsync).toHaveBeenCalledTimes(1);

		resolveMutation?.({ data: { markedRead: 6 } });
		await waitFor(() => {
			expect(screen.queryByRole('dialog', { name: 'Mark all as read?' })).toBeNull();
		});
	});

	it('keeps the dialog open with an actionable error and allows retry after rejection', async () => {
		markAllReadMutateAsync
			.mockRejectedValueOnce(new Error('Network unavailable.'))
			.mockResolvedValueOnce({ data: { markedRead: 6 } });
		render(
			<FeedView categoryId="category-1" selectedArticleId={null} onSelectArticle={() => {}} />,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
		let dialog = screen.getByRole('dialog', { name: 'Mark all as read?' });
		fireEvent.click(within(dialog).getByRole('button', { name: 'Mark all read' }));

		const error = await screen.findByRole('alert');
		expect(error.textContent).toContain('Could not mark articles as read.');
		expect(error.textContent).toContain('Network unavailable.');
		expect(error.textContent).toContain('Check your connection and retry.');
		expect(markAllReadMutateAsync).toHaveBeenCalledTimes(1);

		dialog = screen.getByRole('dialog', { name: 'Mark all as read?' });
		fireEvent.click(within(dialog).getByRole('button', { name: 'Mark all read' }));
		await waitFor(() => {
			expect(markAllReadMutateAsync).toHaveBeenCalledTimes(2);
			expect(markAllReadMutateAsync).toHaveBeenLastCalledWith({
				feedId: undefined,
				categoryId: 'category-1',
			});
			expect(screen.queryByRole('dialog', { name: 'Mark all as read?' })).toBeNull();
		});
	});

	it('labels publisher 403 failures as an external feed issue instead of an app access error', () => {
		reviewFeed().syncStatus = 'error';
		reviewFeed().lastSyncError = 'HTTP 403: Forbidden';
		reviewFeed().lastSyncErrorAt = '2026-07-16T12:00:00.000Z';

		render(<FeedView feedId="feed-42" selectedArticleId={null} onSelectArticle={() => {}} />);

		const sourceIssue = screen.getByRole('status', { name: 'Feed source issue' });
		expect(sourceIssue.textContent).toContain('Feed source unavailable');
		expect(sourceIssue.textContent).toContain('Your SelfFeed account is not blocked');
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('allows refreshing for category views', () => {
		render(
			<FeedView categoryId="category-1" selectedArticleId={null} onSelectArticle={() => {}} />,
		);

		const refreshButton = screen.getByRole('button', { name: 'Refresh' });
		expect((refreshButton as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(refreshButton);
		expect(refreshFeed).toHaveBeenCalledWith(undefined, {
			force: true,
			categoryId: 'category-1',
		});
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

	it('shows long all-feeds syncs as background work without trapping refresh controls', () => {
		allFeedsRefreshIsTakingLonger = true;
		allFeedsRefreshShouldShowStatus = true;

		const { container } = render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		expect(screen.getByText('Still syncing in background')).toBeTruthy();
		expect(screen.getByText('Articles will update as new stories arrive')).toBeTruthy();
		expect(container.querySelector('.motion-safe\\:animate-spin')).toBeTruthy();

		const refreshButton = screen.getByRole('button', { name: 'Refresh' });
		expect((refreshButton as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(refreshButton);
		expect(refreshFeed).toHaveBeenCalled();
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
				{ enabled: true },
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
				{ enabled: true },
			);
		});
	});

	it('uses the persisted default sort preference when loading articles', async () => {
		defaultSortPreference = 'oldest';

		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		await waitFor(() => {
			expect(useInfiniteArticlesMock).toHaveBeenLastCalledWith(
				expect.objectContaining({ sort: 'oldest' }),
				{ enabled: true },
			);
		});
	});

	it('does not issue an article request until preferences are hydrated', () => {
		preferencesLoaded = false;
		const view = render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		expect(useInfiniteArticlesMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ unreadOnly: false, sort: 'latest' }),
			{ enabled: false },
		);

		hideReadPreference = true;
		defaultSortPreference = 'oldest';
		preferencesLoaded = true;
		view.rerender(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		expect(useInfiniteArticlesMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ unreadOnly: true, sort: 'oldest' }),
			{ enabled: true },
		);
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

	it('keeps a locally read selected article visible in unread-only view until manual refresh', async () => {
		const onSelectArticle = vi.fn();
		hideReadPreference = true;
		useInfiniteArticlesMock.mockReturnValue({
			data: {
				pages: [
					{
						data: [{ id: 'article-7', feedId: 'feed-42', isRead: false }],
					},
				],
			},
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		});

		const { rerender } = render(
			<FeedView selectedArticleId={null} onSelectArticle={onSelectArticle} />,
		);

		await waitFor(() => {
			expect(useInfiniteArticlesMock).toHaveBeenLastCalledWith(
				expect.objectContaining({ unreadOnly: true }),
				{ enabled: true },
			);
		});

		articleListProps?.onSelect('article-7');

		expect(markReadMutate).toHaveBeenCalledWith({ articleId: 'article-7', read: true });
		expect(onSelectArticle).toHaveBeenCalledWith('article-7');

		useInfiniteArticlesMock.mockReturnValue({
			data: { pages: [{ data: [] }] },
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		});

		rerender(<FeedView selectedArticleId="article-7" onSelectArticle={onSelectArticle} />);

		await waitFor(() => {
			expect(articleListProps?.articles).toEqual([
				expect.objectContaining({ id: 'article-7', isRead: true }),
			]);
		});

		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
		await waitFor(() => {
			expect(articleListProps?.articles).toEqual([]);
		});
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

	it('shows a retryable failure instead of an empty state when articles fail without data', () => {
		const refetch = vi.fn();
		useInfiniteArticlesMock.mockReturnValue({
			data: undefined,
			error: new Error('request failed'),
			isError: true,
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			refetch,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		});

		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not load articles')).toBeTruthy();
		expect(screen.queryByText('Article list')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(refetch).toHaveBeenCalledTimes(1);
	});

	it('keeps stale articles visible when their background refresh fails', () => {
		const refetch = vi.fn();
		useInfiniteArticlesMock.mockReturnValue({
			data: {
				pages: [{ data: [{ id: 'article-7', feedId: 'feed-42', isRead: false }] }],
			},
			error: new Error('refresh failed'),
			isError: true,
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			refetch,
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		});

		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		expect(screen.getByText('Articles could not be refreshed')).toBeTruthy();
		expect(screen.getByText('Article list')).toBeTruthy();
		expect(articleListProps?.articles).toEqual([expect.objectContaining({ id: 'article-7' })]);
	});

	it('keeps a successful empty article response as an empty list, not an error', () => {
		useInfiniteArticlesMock.mockReturnValue({
			data: { pages: [{ data: [] }] },
			error: null,
			isError: false,
			isFetching: false,
			isFetchingNextPage: false,
			isLoading: false,
			refetch: vi.fn(),
			fetchNextPage: vi.fn(),
			hasNextPage: false,
		});

		render(<FeedView selectedArticleId={null} onSelectArticle={() => {}} />);

		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByText('Article list')).toBeTruthy();
		expect(articleListProps?.articles).toEqual([]);
	});
});
