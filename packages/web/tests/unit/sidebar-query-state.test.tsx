import type { CategoryWithCounts } from '@self-feed/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../src/components/layout/sidebar';

const refetchCategories = vi.fn();
let categoryData: CategoryWithCounts[] | undefined;
let categoryError: Error | null;
let categoryFailed: boolean;

vi.mock('../../src/hooks/queries', () => ({
	useCategories: () => ({
		data: categoryData,
		error: categoryError,
		isError: categoryFailed,
		isFetching: false,
		isLoading: false,
		refetch: refetchCategories,
	}),
	useDeleteCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useDeleteFeed: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useExportOpml: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useReorderCategories: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../src/components/management/category-dialog', () => ({ CategoryDialog: () => null }));
vi.mock('../../src/components/management/feed-dialog', () => ({ FeedDialog: () => null }));
vi.mock('../../src/components/management/opml-import-dialog', () => ({
	OpmlImportDialog: () => null,
}));
vi.mock('../../src/components/management/confirm-dialog', () => ({ ConfirmDialog: () => null }));

function renderSidebar() {
	return render(
		<Sidebar
			variant="drawer"
			onSelectAll={() => {}}
			onSelectFeed={() => {}}
			onSelectCategory={() => {}}
		/>,
	);
}

describe('Sidebar query states', () => {
	beforeEach(() => {
		refetchCategories.mockReset();
		categoryData = [];
		categoryError = null;
		categoryFailed = false;
	});

	it('shows a retryable failure when categories have no usable data', () => {
		categoryData = undefined;
		categoryError = new Error('request failed');
		categoryFailed = true;

		renderSidebar();

		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not load feeds')).toBeTruthy();
		expect(screen.queryByText('Your feeds')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(refetchCategories).toHaveBeenCalledTimes(1);
	});

	it('renders the genuine empty state after a successful empty response', () => {
		renderSidebar();

		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByText('Your feeds')).toBeTruthy();
		expect(screen.getByText('0')).toBeTruthy();
	});
});
