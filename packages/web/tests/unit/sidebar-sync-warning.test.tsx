import type { FeedWithCounts } from '@self-feed/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarTree } from '../../src/components/layout/sidebar-tree';

const noop = () => {};

function feed(overrides: Partial<FeedWithCounts> = {}): FeedWithCounts {
	return {
		id: 'feed-1',
		userId: 'user-1',
		categoryId: 'uncategorized',
		title: 'Phoronix',
		feedUrl: 'https://www.phoronix.com/rss.php',
		siteUrl: 'https://www.phoronix.com',
		faviconUrl: null,
		description: null,
		pollingIntervalMinutes: 60,
		lastSyncedAt: null,
		syncStatus: 'idle',
		lastSyncError: null,
		lastSyncErrorAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		unreadCount: 0,
		...overrides,
	};
}

function renderTree(uncategorizedFeeds: FeedWithCounts[]) {
	return render(
		<SidebarTree
			totalUnread={0}
			categories={[]}
			uncategorizedFeeds={uncategorizedFeeds}
			uncategorizedExpanded
			expandedCategories={new Set()}
			categoryFeedMap={new Map()}
			onSelectAll={noop}
			onSelectFeed={noop}
			onSelectCategory={noop}
			onToggleCategory={noop}
			onToggleUncategorized={noop}
			onReorderCategory={noop}
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
}

describe('SidebarTree feed sync warnings', () => {
	it('shows a warning beside feeds whose latest refresh failed', () => {
		renderTree([
			feed({
				syncStatus: 'error',
				lastSyncError: 'HTTP 403: Forbidden',
				lastSyncErrorAt: '2026-06-23T09:00:00.000Z',
			}),
		]);

		const warning = screen.getByLabelText(/Phoronix is not updating\. HTTP 403: Forbidden/);
		expect(warning).toBeTruthy();
		expect(warning.getAttribute('title')).toContain('Phoronix is not updating');
	});

	it('does not show a warning for healthy feeds', () => {
		renderTree([feed()]);

		expect(screen.queryByLabelText(/Phoronix is not updating/)).toBeNull();
	});

	it('still opens the feed when the warning icon is present', () => {
		const onSelectFeed = vi.fn();
		render(
			<SidebarTree
				totalUnread={0}
				categories={[]}
				uncategorizedFeeds={[
					feed({
						syncStatus: 'error',
						lastSyncError: 'Previous sync was interrupted before it could finish',
					}),
				]}
				uncategorizedExpanded
				expandedCategories={new Set()}
				categoryFeedMap={new Map()}
				onSelectAll={noop}
				onSelectFeed={onSelectFeed}
				onSelectCategory={noop}
				onToggleCategory={noop}
				onToggleUncategorized={noop}
				onReorderCategory={noop}
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

		screen.getByRole('button', { name: 'Phoronix' }).click();

		expect(onSelectFeed).toHaveBeenCalledWith('feed-1');
	});
});
