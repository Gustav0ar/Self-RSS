import type { CategoryWithCounts } from '@self-feed/shared';

export interface CategoryReorderUpdate {
	id: string;
	sortOrder: number;
}

export function computeCategoryReorderUpdates(
	categories: CategoryWithCounts[],
	sourceId: string,
	targetId: string | null,
): CategoryReorderUpdate[] {
	if (sourceId === targetId) return [];

	const source = categories.find((category) => category.id === sourceId);
	if (!source) return [];
	const target = targetId ? categories.find((category) => category.id === targetId) : null;
	const sourceParentId = source.parentCategoryId ?? null;
	const targetParentId = target ? (target.parentCategoryId ?? null) : null;
	if (sourceParentId !== targetParentId) return [];

	const originalOrder = categories.filter(
		(category) => (category.parentCategoryId ?? null) === sourceParentId,
	);
	const ordered = [...originalOrder];
	const sourceIndex = ordered.findIndex((category) => category.id === sourceId);
	if (sourceIndex < 0) return [];
	const [moved] = ordered.splice(sourceIndex, 1);
	if (!moved) return [];

	// `targetId == null` is the "drop at the end" case. Otherwise insert
	// after the target row, matching the visual "move below this row" behavior.
	let insertAt: number;
	if (targetId == null) {
		insertAt = ordered.length;
	} else {
		const targetIndex = ordered.findIndex((category) => category.id === targetId);
		insertAt = targetIndex < 0 ? ordered.length : targetIndex + 1;
		if (sourceIndex < targetIndex) {
			insertAt = targetIndex;
		}
	}
	ordered.splice(insertAt, 0, moved);

	return ordered
		.map((category, index) => ({ id: category.id, sortOrder: index }))
		.filter((update, index) => {
			const original = originalOrder[index];
			return !original || original.id !== update.id || original.sortOrder !== update.sortOrder;
		});
}
