import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedDialog } from '../../src/components/management/feed-dialog';

const createMutateAsync = vi.fn();
const createCategoryMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

vi.mock('@/hooks/queries', () => ({
	useCreateCategory: () => ({
		mutateAsync: createCategoryMutateAsync,
		isPending: false,
	}),
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

	it('submits a new feed and honestly confirms queued validation', async () => {
		createMutateAsync.mockResolvedValue({ data: { lifecycleStatus: 'pending' } });
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
		expect(screen.getByText(/Validation is queued/)).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', { name: 'Done' }));
		expect(onClose).toHaveBeenCalledOnce();
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

	it('creates a General category before adding the first feed', async () => {
		createCategoryMutateAsync.mockResolvedValue({ data: { id: 'general-1' } });
		createMutateAsync.mockResolvedValue({ data: { lifecycleStatus: 'pending' } });

		render(<FeedDialog mode="create" categories={[]} onClose={() => {}} />);

		expect(screen.getByRole('note', { name: 'Default feed category' }).textContent).toContain(
			'SelfFeed will create General first',
		);
		expect(screen.queryByLabelText('Feed category')).toBeNull();
		fireEvent.change(screen.getByLabelText('Feed URL'), {
			target: { value: 'https://example.com/first.xml' },
		});
		fireEvent.change(screen.getByLabelText('Custom name (optional)'), {
			target: { value: 'My first feed' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));

		await waitFor(() => {
			expect(createCategoryMutateAsync).toHaveBeenCalledWith({ name: 'General' });
			expect(createMutateAsync).toHaveBeenCalledWith({
				feedUrl: 'https://example.com/first.xml',
				categoryId: 'general-1',
				title: 'My first feed',
			});
		});
		expect(screen.getByText(/Validation is queued/)).toBeTruthy();
	});

	it('preserves first-feed fields when creating General fails', async () => {
		createCategoryMutateAsync.mockRejectedValue(new Error('Could not create General'));

		render(<FeedDialog mode="create" categories={[]} onClose={() => {}} />);
		fireEvent.change(screen.getByLabelText('Feed URL'), {
			target: { value: 'https://example.com/first.xml' },
		});
		fireEvent.change(screen.getByLabelText('Custom name (optional)'), {
			target: { value: 'Keep this title' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));

		expect(await screen.findByText('Could not create General')).toBeTruthy();
		expect(createMutateAsync).not.toHaveBeenCalled();
		expect((screen.getByLabelText('Feed URL') as HTMLInputElement).value).toBe(
			'https://example.com/first.xml',
		);
		expect((screen.getByLabelText('Custom name (optional)') as HTMLInputElement).value).toBe(
			'Keep this title',
		);
	});

	it('reuses General when feed creation fails and the user retries', async () => {
		createCategoryMutateAsync.mockResolvedValue({ data: { id: 'general-1' } });
		createMutateAsync
			.mockRejectedValueOnce(new Error('Feed validation unavailable'))
			.mockResolvedValueOnce({ data: { lifecycleStatus: 'pending' } });

		render(<FeedDialog mode="create" categories={[]} onClose={() => {}} />);
		fireEvent.change(screen.getByLabelText('Feed URL'), {
			target: { value: 'https://example.com/retry.xml' },
		});
		fireEvent.change(screen.getByLabelText('Custom name (optional)'), {
			target: { value: 'Retry feed' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));

		expect(await screen.findByText('Feed validation unavailable')).toBeTruthy();
		expect(createCategoryMutateAsync).toHaveBeenCalledTimes(1);
		expect((screen.getByLabelText('Feed URL') as HTMLInputElement).value).toBe(
			'https://example.com/retry.xml',
		);
		expect((screen.getByLabelText('Custom name (optional)') as HTMLInputElement).value).toBe(
			'Retry feed',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));
		await waitFor(() => {
			expect(createMutateAsync).toHaveBeenCalledTimes(2);
		});

		expect(createCategoryMutateAsync).toHaveBeenCalledTimes(1);
		expect(createMutateAsync).toHaveBeenNthCalledWith(2, {
			feedUrl: 'https://example.com/retry.xml',
			categoryId: 'general-1',
			title: 'Retry feed',
		});
		expect(screen.getByText(/Validation is queued/)).toBeTruthy();
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
		updateMutateAsync.mockResolvedValue({ data: { lifecycleStatus: 'active' } });

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

	it('keeps the dialog open while a replacement source is validated', async () => {
		updateMutateAsync.mockResolvedValue({
			data: {
				lifecycleStatus: 'replacement_pending',
				ingestionRequestId: 'request-1',
			},
		});
		const onClose = vi.fn();

		render(
			<FeedDialog mode="edit" categories={sampleCategories} feed={sampleFeed} onClose={onClose} />,
		);

		fireEvent.change(screen.getByLabelText('Feed URL'), {
			target: { value: 'https://example.com/replacement.xml' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() => {
			expect(
				screen.getByText(
					'Replacement validation is queued; the current source remains active until validation succeeds.',
				),
			).toBeTruthy();
		});
		expect(onClose).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', { name: 'Done' }));
		expect(onClose).toHaveBeenCalledOnce();
	});
});
