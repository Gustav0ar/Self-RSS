import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryDialog } from '../../src/components/management/category-dialog';

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

vi.mock('@/hooks/queries', () => ({
	useCreateCategory: () => ({
		mutateAsync: createMutateAsync,
		isPending: false,
	}),
	useUpdateCategory: () => ({
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

describe('CategoryDialog - create mode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('submits a new category and closes the dialog on success', async () => {
		createMutateAsync.mockResolvedValue({});
		const onClose = vi.fn();

		render(<CategoryDialog mode="create" categories={sampleCategories} onClose={onClose} />);

		fireEvent.change(screen.getByLabelText('Name'), {
			target: { value: 'Frontend' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add category' }));

		await waitFor(() => {
			expect(createMutateAsync).toHaveBeenCalledWith({
				name: 'Frontend',
				parentCategoryId: null,
			});
		});
		expect(onClose).toHaveBeenCalled();
	});

	it('uses the default parent category id when provided', async () => {
		createMutateAsync.mockResolvedValue({});
		const onClose = vi.fn();

		render(
			<CategoryDialog
				mode="create"
				categories={sampleCategories}
				defaultParentCategoryId="cat-1"
				onClose={onClose}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Name'), {
			target: { value: 'Frontend' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add category' }));

		await waitFor(() => {
			expect(createMutateAsync).toHaveBeenCalledWith({
				name: 'Frontend',
				parentCategoryId: 'cat-1',
			});
		});
	});

	it('surfaces the server error message on failure', async () => {
		createMutateAsync.mockRejectedValue(new Error('Name is already taken'));

		render(<CategoryDialog mode="create" categories={sampleCategories} onClose={() => {}} />);

		fireEvent.change(screen.getByLabelText('Name'), {
			target: { value: 'Tech' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add category' }));

		await waitFor(() => {
			expect(screen.getByText('Name is already taken')).toBeTruthy();
		});
	});
});

describe('CategoryDialog - edit mode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('prefills the inputs from the existing category', () => {
		render(
			<CategoryDialog
				mode="edit"
				categories={sampleCategories}
				category={sampleCategories[1]}
				onClose={() => {}}
			/>,
		);

		expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Backend');
		expect((screen.getByLabelText('Parent category') as HTMLSelectElement).value).toBe('cat-1');
	});

	it('excludes the current category from the parent dropdown to prevent cycles', () => {
		render(
			<CategoryDialog
				mode="edit"
				categories={sampleCategories}
				category={sampleCategories[1]}
				onClose={() => {}}
			/>,
		);

		const parentSelect = screen.getByLabelText('Parent category') as HTMLSelectElement;
		const optionIds = Array.from(parentSelect.options).map((o) => o.value);
		expect(optionIds).not.toContain('cat-2');
	});

	it('submits the update and closes the dialog on success', async () => {
		updateMutateAsync.mockResolvedValue({});

		render(
			<CategoryDialog
				mode="edit"
				categories={sampleCategories}
				category={sampleCategories[1]}
				onClose={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Name'), {
			target: { value: 'Backend Services' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() => {
			expect(updateMutateAsync).toHaveBeenCalledWith({
				id: 'cat-2',
				name: 'Backend Services',
				parentCategoryId: 'cat-1',
			});
		});
	});
});

describe('CategoryDialog - cancel button', () => {
	it('closes the dialog without calling any mutation when Cancel is clicked', () => {
		const onClose = vi.fn();

		render(<CategoryDialog mode="create" categories={sampleCategories} onClose={onClose} />);

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onClose).toHaveBeenCalled();
		expect(createMutateAsync).not.toHaveBeenCalled();
	});
});
