import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedDialog } from '../../src/components/management/feed-dialog';

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

vi.mock('@/hooks/queries', () => ({
	useCreateFeed: () => ({
		mutateAsync: createMutateAsync,
		isPending: false,
	}),
	useUpdateFeed: () => ({
		mutateAsync: updateMutateAsync,
		isPending: false,
	}),
}));

const sampleCategories = [
	{
		id: 'cat-1',
		userId: 'user-1',
		parentCategoryId: null,
		name: 'Tech',
		slug: 'tech',
		sortOrder: 0,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		feedCount: 0,
		unreadCount: 0,
		feeds: [],
	},
	{
		id: 'cat-2',
		userId: 'user-1',
		parentCategoryId: 'cat-1',
		name: 'Backend',
		slug: 'backend',
		sortOrder: 0,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		feedCount: 0,
		unreadCount: 0,
		feeds: [],
	},
];

describe('FeedDialog - add mode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('submits a new feed and closes the dialog on success', async () => {
		createMutateAsync.mockResolvedValue({});
		const onClose = vi.fn();

		render(<FeedDialog mode="create" categories={sampleCategories} onClose={onClose} />);

		fireEvent.change(screen.getByLabelText('Feed URL'), {
			target: { value: 'https://example.com/feed.xml' },
		});
		fireEvent.change(screen.getByLabelText('Feed category'), {
			target: { value: 'cat-1' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));

		await waitFor(() => {
			expect(createMutateAsync).toHaveBeenCalledWith({
				feedUrl: 'https://example.com/feed.xml',
				categoryId: 'cat-1',
				title: undefined,
			});
		});
		expect(onClose).toHaveBeenCalled();
	});

	it('surfaces the server error on failure', async () => {
		createMutateAsync.mockRejectedValue(new Error('Could not fetch or parse the feed URL'));

		render(<FeedDialog mode="create" categories={sampleCategories} onClose={() => {}} />);

		fireEvent.change(screen.getByLabelText('Feed URL'), {
			target: { value: 'https://broken.example/feed.xml' },
		});
		fireEvent.change(screen.getByLabelText('Feed category'), {
			target: { value: 'cat-1' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));

		await waitFor(() => {
			expect(screen.getByText('Could not fetch or parse the feed URL')).toBeTruthy();
		});
	});
});

describe('FeedDialog - edit mode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const sampleFeed = {
		id: 'feed-1',
		userId: 'user-1',
		categoryId: 'cat-2',
		title: 'DevTools Digest',
		feedUrl: 'https://example.com/devtools.xml',
		siteUrl: 'https://example.com',
		faviconUrl: null,
		description: 'A test feed',
		pollingIntervalMinutes: 60,
		lastSyncedAt: null,
		lastSyncError: null,
		lastSyncErrorAt: null,
		syncStatus: 'idle' as const,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		unreadCount: 0,
	};

	it('prefills the form with the existing feed values', () => {
		render(
			<FeedDialog mode="edit" categories={sampleCategories} feed={sampleFeed} onClose={() => {}} />,
		);

		expect((screen.getByLabelText('Custom name (optional)') as HTMLInputElement).value).toBe(
			'DevTools Digest',
		);
		expect((screen.getByLabelText('Feed URL') as HTMLInputElement).value).toBe(
			'https://example.com/devtools.xml',
		);
		expect((screen.getByLabelText('Feed category') as HTMLSelectElement).value).toBe('cat-2');
		expect((screen.getByLabelText('Polling interval (minutes)') as HTMLInputElement).value).toBe(
			'60',
		);
	});

	it('allows the existing feed URL to be edited', () => {
		render(
			<FeedDialog mode="edit" categories={sampleCategories} feed={sampleFeed} onClose={() => {}} />,
		);

		const input = screen.getByLabelText('Feed URL') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'https://example.com/replacement.xml' } });
		expect(input.value).toBe('https://example.com/replacement.xml');
	});

	it('shows the latest refresh failure in edit mode', () => {
		render(
			<FeedDialog
				mode="edit"
				categories={sampleCategories}
				feed={{
					...sampleFeed,
					syncStatus: 'error',
					lastSyncError: 'HTTP 403: Forbidden',
					lastSyncErrorAt: '2026-07-15T10:00:00.000Z',
				}}
				onClose={() => {}}
			/>,
		);

		expect(screen.getByRole('status', { name: 'Feed refresh issue' }).textContent).toContain(
			'HTTP 403: Forbidden',
		);
		expect(screen.getByText(/Review the URL and polling interval/)).toBeTruthy();
	});

	it('submits only the editable fields on save', async () => {
		updateMutateAsync.mockResolvedValue({});

		render(
			<FeedDialog mode="edit" categories={sampleCategories} feed={sampleFeed} onClose={vi.fn()} />,
		);

		fireEvent.change(screen.getByLabelText('Custom name (optional)'), {
			target: { value: 'My DevTools' },
		});
		fireEvent.change(screen.getByLabelText('Feed URL'), {
			target: { value: 'https://example.com/replacement.xml' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() => {
			expect(updateMutateAsync).toHaveBeenCalledWith({
				id: 'feed-1',
				feedUrl: 'https://example.com/replacement.xml',
				title: 'My DevTools',
				categoryId: 'cat-2',
				pollingIntervalMinutes: 60,
			});
		});
	});
});
