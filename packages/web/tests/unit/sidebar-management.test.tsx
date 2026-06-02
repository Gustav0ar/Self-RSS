import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedDialog } from '../../src/components/management/feed-dialog';
import {
	getCategoryDeleteDescription,
	shouldWarnOnCategoryDelete,
} from '../../src/components/management/management-utils';
import { OpmlImportDialog } from '../../src/components/management/opml-import-dialog';

const createFeedMutateAsync = vi.fn();
const updateFeedMutateAsync = vi.fn();
const importOpmlMutateAsync = vi.fn();

vi.mock('../../src/hooks/queries', () => ({
	useCreateFeed: () => ({ mutateAsync: createFeedMutateAsync, isPending: false }),
	useUpdateFeed: () => ({ mutateAsync: updateFeedMutateAsync, isPending: false }),
	useImportOpml: () => ({ mutateAsync: importOpmlMutateAsync, isPending: false }),
}));

function renderWithQueryClient(node: React.ReactNode) {
	const queryClient = new QueryClient();
	return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe('management utils', () => {
	it('warns before deleting a category with feeds', () => {
		expect(shouldWarnOnCategoryDelete(2)).toBe(true);
		expect(getCategoryDeleteDescription('Tech', 2)).toContain('still has 2 linked feeds');
	});

	it('uses the destructive message for empty categories', () => {
		expect(shouldWarnOnCategoryDelete(0)).toBe(false);
		expect(getCategoryDeleteDescription('Empty', 0)).toContain('cannot be undone');
	});
});

describe('FeedDialog', () => {
	it('submits a create request with an omitted custom name when blank', async () => {
		createFeedMutateAsync.mockResolvedValueOnce({});

		renderWithQueryClient(
			<FeedDialog
				mode="create"
				categories={[
					{
						id: 'category-1',
						userId: 'user-1',
						parentCategoryId: null,
						name: 'Tech',
						slug: 'tech',
						sortOrder: 0,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						feedCount: 0,
						unreadCount: 0,
					},
				]}
				onClose={() => {}}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Feed URL'), {
			target: { value: 'https://example.com/feed.xml' },
		});
		fireEvent.change(screen.getByLabelText('Custom name (optional)'), {
			target: { value: '   ' },
		});
		fireEvent.submit(screen.getByRole('button', { name: 'Add feed' }));

		await waitFor(() => {
			expect(createFeedMutateAsync).toHaveBeenCalledWith({
				feedUrl: 'https://example.com/feed.xml',
				categoryId: 'category-1',
				title: undefined,
			});
		});
	});
});

describe('OpmlImportDialog', () => {
	it('renders the import summary after a successful upload', async () => {
		importOpmlMutateAsync.mockResolvedValueOnce({
			createdCategories: 2,
			createdFeeds: 3,
			skippedDuplicates: 1,
			invalidEntries: 0,
			warnings: [{ code: 'DUPLICATE_FEED', message: 'Skipped duplicate feed' }],
		});

		renderWithQueryClient(<OpmlImportDialog onClose={() => {}} />);

		const file = new File(['<opml />'], 'feeds.opml', { type: 'text/xml' });
		const fileInput = screen.getByLabelText('OPML file');
		fireEvent.change(fileInput, { target: { files: [file] } });
		fireEvent.submit(screen.getByRole('button', { name: 'Import feeds' }));

		await waitFor(() => {
			expect(importOpmlMutateAsync).toHaveBeenCalledWith(file);
		});

		expect(await screen.findByText('Import summary')).toBeTruthy();
		expect(screen.getByText('3')).toBeTruthy();
		expect(screen.getByText('Skipped duplicate feed')).toBeTruthy();
	});
});
