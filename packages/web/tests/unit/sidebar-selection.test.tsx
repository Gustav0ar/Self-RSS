import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
		feeds: [
			{
				id: 'feed-1',
				categoryId: 'category-1',
				title: 'A very long feed title that should stay clipped correctly',
				faviconUrl: null,
				unreadCount: 7,
			},
		],
	},
];

vi.mock('../../src/hooks/queries', () => ({
	useCategories: () => ({ data: categories }),
	useDeleteCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteFeed: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useExportOpml: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useReorderCategories: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useUpdateCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../src/components/management/category-dialog', () => ({
	CategoryDialog: () => null,
}));
vi.mock('../../src/components/management/feed-dialog', () => ({
	FeedDialog: () => null,
}));
vi.mock('../../src/components/management/opml-import-dialog', () => ({
	OpmlImportDialog: () => null,
}));
vi.mock('../../src/components/management/confirm-dialog', () => ({
	ConfirmDialog: () => null,
}));

function renderSidebar(props?: Partial<React.ComponentProps<typeof Sidebar>>) {
	const queryClient = new QueryClient();
	const onSelectCategory = vi.fn();
	const result = render(
		<QueryClientProvider client={queryClient}>
			<Sidebar
				selectedFeedId="feed-1"
				onSelectAll={() => {}}
				onSelectFeed={() => {}}
				onSelectCategory={onSelectCategory}
				{...props}
			/>
		</QueryClientProvider>,
	);

	return { ...result, onSelectCategory };
}

describe('Sidebar selection', () => {
	beforeEach(() => {
		// The Sidebar persists its expansion state in localStorage; tests
		// share the same jsdom store, so we reset it before each test to
		// avoid one test's expanded set bleeding into the next.
		try {
			window.localStorage?.clear();
		} catch {
			// Some test runners (bun) don't provide localStorage; the
			// sidebar's load is wrapped in try/catch already, so this is
			// safe to skip.
		}
	});

	it('expands the parent category when the selected feed is active on load', async () => {
		renderSidebar();

		expect(
			await screen.findByText('A very long feed title that should stay clipped correctly'),
		).toBeTruthy();
		expect(screen.getByText('Blogs')).toBeTruthy();
	});

	it('toggles the chevron without selecting the category', () => {
		const { onSelectCategory } = renderSidebar({ selectedFeedId: undefined });
		const feedTitle = 'A very long feed title that should stay clipped correctly';

		const chevronButton = screen.getByRole('button', { name: 'Expand Blogs' });
		fireEvent.click(chevronButton);

		expect(onSelectCategory).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Collapse Blogs' })).toBeTruthy();
		expect(screen.getAllByText(feedTitle).length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole('button', { name: 'Collapse Blogs' }));
		expect(onSelectCategory).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Expand Blogs' })).toBeTruthy();
		expect(screen.queryByText(feedTitle)).toBeNull();
	});

	it('selects the category when clicking the category row', () => {
		const { onSelectCategory } = renderSidebar({ selectedFeedId: undefined });

		fireEvent.click(screen.getByRole('button', { name: 'Blogs 7' }));
		expect(onSelectCategory).toHaveBeenCalledWith('category-1');
	});
});
