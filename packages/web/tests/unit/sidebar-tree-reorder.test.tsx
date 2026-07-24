import type { CategoryWithCounts } from '@self-feed/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarTree } from '../../src/components/layout/sidebar-tree';

const noop = () => {};

function category(
	id: string,
	name: string,
	sortOrder: number,
	parentCategoryId: string | null = null,
	children: CategoryWithCounts[] = [],
): CategoryWithCounts {
	return {
		id,
		userId: 'user-1',
		parentCategoryId,
		name,
		slug: id,
		sortOrder,
		createdAt: '2026-07-24T00:00:00.000Z',
		updatedAt: '2026-07-24T00:00:00.000Z',
		feedCount: 0,
		unreadCount: 0,
		feeds: [],
		children,
	};
}

function renderTree(
	categories: CategoryWithCounts[],
	onReorderCategory = vi.fn().mockResolvedValue(true),
	expandedCategories = new Set<string>(),
) {
	render(
		<SidebarTree
			totalUnread={0}
			categories={categories}
			uncategorizedFeeds={[]}
			uncategorizedExpanded
			expandedCategories={expandedCategories}
			categoryFeedMap={new Map()}
			onSelectAll={noop}
			onSelectFeed={noop}
			onSelectCategory={noop}
			onToggleCategory={noop}
			onToggleUncategorized={noop}
			onReorderCategory={onReorderCategory}
			draggingCategoryId={null}
			dragOverCategoryId={null}
			onCategoryDragStart={noop}
			onCategoryDragEnd={noop}
			onCategoryDragOver={noop}
			onCategoryDragLeave={noop}
			onEditCategory={noop}
			onDeleteCategory={noop}
			onEditFeed={noop}
			onDeleteFeed={noop}
		/>,
	);
	return onReorderCategory;
}

describe('SidebarTree category move controls', () => {
	it('moves a category up through the sibling-only reorder callback and announces success', async () => {
		const onReorderCategory = renderTree([
			category('first', 'First', 0),
			category('second', 'Second', 1),
			category('third', 'Third', 2),
		]);
		const trigger = screen.getByRole('button', { name: 'Move Second' });

		fireEvent.click(trigger);
		const menu = screen.getByRole('menu', { name: 'Move Second' });
		const moveUp = within(menu).getByRole('menuitem', { name: 'Move up' });
		await waitFor(() => expect(document.activeElement).toBe(moveUp));
		expect(trigger.className).toContain('h-11');
		expect(moveUp.className).toContain('min-h-11');

		fireEvent.click(moveUp);

		await waitFor(() => {
			expect(onReorderCategory).toHaveBeenCalledWith('first', 'second');
			expect(screen.getByText('Second moved up to position 1 of 3.')).toBeTruthy();
			expect(screen.queryByRole('menu', { name: 'Move Second' })).toBeNull();
			expect(document.activeElement).toBe(trigger);
		});
	});

	it('moves a category down with a deterministic adjacent-sibling target', async () => {
		const onReorderCategory = renderTree([
			category('first', 'First', 0),
			category('second', 'Second', 1),
			category('third', 'Third', 2),
		]);

		fireEvent.click(screen.getByRole('button', { name: 'Move Second' }));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

		await waitFor(() => {
			expect(onReorderCategory).toHaveBeenCalledWith('second', 'third');
			expect(screen.getByText('Second moved down to position 3 of 3.')).toBeTruthy();
		});
	});

	it('disables sibling boundaries and never offers a cross-parent move', () => {
		const childA = category('child-a', 'Child A', 0, 'parent-a');
		const childB = category('child-b', 'Child B', 1, 'parent-a');
		renderTree(
			[
				category('parent-a', 'Parent A', 0, null, [childA, childB]),
				category('parent-b', 'Parent B', 1),
			],
			vi.fn().mockResolvedValue(true),
			new Set(['parent-a']),
		);

		fireEvent.click(screen.getByRole('button', { name: 'Move Parent A' }));
		expect((screen.getByRole('menuitem', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

		fireEvent.click(screen.getByRole('button', { name: 'Move Child A' }));
		expect((screen.getByRole('menuitem', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(
			(screen.getByRole('menuitem', { name: 'Move down' }) as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it('closes on Escape, restores trigger focus, and performs no reorder', async () => {
		const onReorderCategory = vi.fn().mockResolvedValue(true);
		renderTree([category('first', 'First', 0), category('second', 'Second', 1)], onReorderCategory);
		const trigger = screen.getByRole('button', { name: 'Move First' });

		fireEvent.click(trigger);
		const menu = screen.getByRole('menu', { name: 'Move First' });
		fireEvent.keyDown(menu, { key: 'Escape' });

		await waitFor(() => {
			expect(screen.queryByRole('menu', { name: 'Move First' })).toBeNull();
			expect(document.activeElement).toBe(trigger);
		});
		expect(onReorderCategory).not.toHaveBeenCalled();
	});

	it('does not announce a move rejected by the persistence layer', async () => {
		const onReorderCategory = vi.fn().mockResolvedValue(false);
		renderTree([category('first', 'First', 0), category('second', 'Second', 1)], onReorderCategory);

		fireEvent.click(screen.getByRole('button', { name: 'Move First' }));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

		await waitFor(() => expect(onReorderCategory).toHaveBeenCalledTimes(1));
		expect(screen.queryByText(/First moved down/)).toBeNull();
		expect(screen.getByRole('menu', { name: 'Move First' })).toBeTruthy();
	});
});
