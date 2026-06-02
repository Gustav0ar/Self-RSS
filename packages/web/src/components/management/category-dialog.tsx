import type { CategoryWithCounts } from '@self-feed/shared';
import { useEffect, useMemo, useState } from 'react';
import { useCreateCategory, useUpdateCategory } from '@/hooks/queries';
import { ModalShell } from './modal-shell';

interface CategoryDialogProps {
	mode: 'create' | 'edit';
	categories: CategoryWithCounts[];
	category?: CategoryWithCounts;
	defaultParentCategoryId?: string;
	onClose: () => void;
}

export function CategoryDialog({
	mode,
	categories,
	category,
	defaultParentCategoryId,
	onClose,
}: CategoryDialogProps) {
	const createCategory = useCreateCategory();
	const updateCategory = useUpdateCategory();
	const [name, setName] = useState('');
	const [parentCategoryId, setParentCategoryId] = useState(defaultParentCategoryId ?? '');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (mode === 'edit' && category) {
			setName(category.name);
			setParentCategoryId(category.parentCategoryId ?? '');
		}
	}, [category, mode]);

	const parentOptions = useMemo(
		() => categories.filter((item) => item.id !== category?.id),
		[categories, category?.id],
	);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);

		try {
			if (mode === 'create') {
				await createCategory.mutateAsync({
					name,
					parentCategoryId: parentCategoryId || null,
				});
			} else if (category) {
				await updateCategory.mutateAsync({
					id: category.id,
					name,
					parentCategoryId: parentCategoryId || null,
				});
			}
			onClose();
		} catch (submitError) {
			setError(submitError instanceof Error ? submitError.message : 'Unable to save category');
		}
	}

	const isPending = createCategory.isPending || updateCategory.isPending;

	return (
		<ModalShell title={mode === 'create' ? 'Add Category' : 'Edit Category'} onClose={onClose}>
			<p className="text-sm leading-6 text-muted-foreground">
				Organize feeds into clear groups so search and browsing stay manageable.
			</p>
			{error ? (
				<div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
					{error}
				</div>
			) : null}
			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label htmlFor="category-name" className="mb-2 block text-sm font-medium">
						Name
					</label>
					<input
						id="category-name"
						type="text"
						value={name}
						onChange={(event) => setName(event.target.value)}
						required
						className="input-surface h-12 w-full rounded-2xl px-4 text-sm outline-none"
					/>
				</div>

				<div>
					<label htmlFor="category-parent" className="mb-2 block text-sm font-medium">
						Parent category
					</label>
					<select
						id="category-parent"
						value={parentCategoryId}
						onChange={(event) => setParentCategoryId(event.target.value)}
						className="input-surface h-12 w-full rounded-2xl px-4 text-sm outline-none"
					>
						<option value="">No parent</option>
						{parentOptions.map((option) => (
							<option key={option.id} value={option.id}>
								{option.name}
							</option>
						))}
					</select>
				</div>

				<div className="flex items-center justify-end gap-2 pt-2">
					<button
						type="button"
						onClick={onClose}
						className="rounded-2xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isPending}
						className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{isPending ? 'Saving...' : mode === 'create' ? 'Add category' : 'Save changes'}
					</button>
				</div>
			</form>
		</ModalShell>
	);
}
