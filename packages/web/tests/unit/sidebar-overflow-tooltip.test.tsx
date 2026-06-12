import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../src/components/layout/sidebar';

const categories = [
	{
		id: 'category-1',
		userId: 'user-1',
		parentCategoryId: null,
		name: 'Blogs',
		slug: 'blogs',
		sortOrder: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		feedCount: 1,
		unreadCount: 7,
	},
];

const longTitle = 'A very long feed title that should show fully in a tooltip';
const feeds = [
	{
		id: 'feed-1',
		categoryId: 'category-1',
		title: longTitle,
		faviconUrl: null,
		unreadCount: 7,
	},
];

vi.mock('../../src/hooks/queries', () => ({
	useCategories: () => ({ data: categories }),
	useFeeds: () => ({ data: feeds }),
	useDeleteCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteFeed: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useExportOpml: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../src/components/management/category-dialog', () => ({ CategoryDialog: () => null }));
vi.mock('../../src/components/management/feed-dialog', () => ({ FeedDialog: () => null }));
vi.mock('../../src/components/management/opml-import-dialog', () => ({
	OpmlImportDialog: () => null,
}));
vi.mock('../../src/components/management/confirm-dialog', () => ({ ConfirmDialog: () => null }));

function renderSidebar() {
	const queryClient = new QueryClient();
	return render(
		<QueryClientProvider client={queryClient}>
			<Sidebar
				selectedFeedId="feed-1"
				onSelectAll={() => {}}
				onSelectFeed={() => {}}
				onSelectCategory={() => {}}
			/>
		</QueryClientProvider>,
	);
}

describe('Sidebar overflow tooltip', () => {
	beforeEach(() => {
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
			configurable: true,
			get() {
				return 80;
			},
		});
		Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
			configurable: true,
			get() {
				return 220;
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('adds a title attribute when the feed name is truncated', async () => {
		renderSidebar();

		const label = await screen.findByTitle(longTitle);
		expect(label).toBeTruthy();
	});
});
