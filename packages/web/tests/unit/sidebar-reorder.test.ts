import type { CategoryWithCounts } from '@self-feed/shared';
import { describe, expect, it } from 'vitest';
import { computeCategoryReorderUpdates } from '../../src/components/layout/sidebar-reorder';

function category(
	id: string,
	sortOrder: number,
	parentCategoryId: string | null = null,
): CategoryWithCounts {
	return {
		id,
		userId: 'user-1',
		parentCategoryId,
		name: id,
		slug: id,
		sortOrder,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		feedCount: 0,
		unreadCount: 0,
		feeds: [],
		children: [],
	};
}

describe('computeCategoryReorderUpdates', () => {
	it('moves a category below a sibling', () => {
		expect(
			computeCategoryReorderUpdates(
				[category('first', 0), category('second', 1), category('third', 2)],
				'first',
				'second',
			),
		).toEqual([
			{ id: 'second', sortOrder: 0 },
			{ id: 'first', sortOrder: 1 },
		]);
	});

	it('moves a sibling to the end when dropped without a target', () => {
		expect(
			computeCategoryReorderUpdates(
				[category('first', 0), category('second', 1), category('third', 2)],
				'first',
				null,
			),
		).toEqual([
			{ id: 'second', sortOrder: 0 },
			{ id: 'third', sortOrder: 1 },
			{ id: 'first', sortOrder: 2 },
		]);
	});

	it('refuses to reorder across different parents', () => {
		expect(
			computeCategoryReorderUpdates(
				[category('parent-a', 0), category('child-a', 0, 'parent-a'), category('parent-b', 1)],
				'child-a',
				'parent-b',
			),
		).toEqual([]);
	});

	it('returns no updates when the order does not change', () => {
		expect(
			computeCategoryReorderUpdates(
				[category('first', 0), category('second', 1)],
				'first',
				'first',
			),
		).toEqual([]);
	});
});
