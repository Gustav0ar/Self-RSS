import type { FeedWithCounts } from '@self-feed/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarTree } from '../../src/components/layout/sidebar-tree';

const noop = () => {};
const reorderNoop = async () => true;

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

function tree(uncategorizedFeeds: FeedWithCounts[]) {
	return (
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
			onReorderCategory={reorderNoop}
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
		/>
	);
}

function renderTree(uncategorizedFeeds: FeedWithCounts[]) {
	return render(tree(uncategorizedFeeds));
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

		const feedButton = screen.getByRole('button', { name: 'Phoronix' });
		expect(feedButton.getAttribute('aria-describedby')).toBe('feed-health-feed-1');
		const stableDescription = document.getElementById('feed-health-feed-1');
		expect(stableDescription?.className).toContain('sr-only');
		expect(stableDescription?.textContent).toMatch(/Your SelfFeed account is not blocked/);
		expect(screen.queryByRole('tooltip')).toBeNull();

		const warning = screen.getByRole('button', { name: 'Show health details for Phoronix' });
		expect(warning.className).toContain('h-11');
		fireEvent.focus(warning);
		expect(screen.getByRole('tooltip').textContent).toMatch(/Your SelfFeed account is not blocked/);
		expect(screen.getByText('Open a warning icon for the latest details.')).toBeTruthy();
		expect(screen.getByRole('status', { name: '1 feed is not updating' })).toBeTruthy();
	});

	it('opens health details on click and closes them with Escape while keeping trigger focus', () => {
		renderTree([feed({ syncStatus: 'error', lastSyncError: 'DNS lookup failed' })]);
		const warning = screen.getByRole('button', { name: 'Show health details for Phoronix' });

		warning.focus();
		fireEvent.click(warning);
		expect(screen.getByRole('tooltip').textContent).toContain('DNS lookup failed');
		expect(warning.getAttribute('aria-expanded')).toBe('true');
		fireEvent.keyDown(warning, { key: 'Escape' });

		expect(screen.queryByRole('tooltip')).toBeNull();
		expect(warning.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(warning);
	});

	it('lets the user dismiss the aggregate warning without hiding row health', () => {
		renderTree([
			feed({
				syncStatus: 'error',
				lastSyncError: 'HTTP 403: Forbidden',
			}),
		]);

		fireEvent.click(screen.getByRole('button', { name: 'Dismiss feed health summary' }));

		expect(screen.queryByRole('status', { name: '1 feed is not updating' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Show health details for Phoronix' })).toBeTruthy();
		expect(document.getElementById('feed-health-feed-1')).toBeTruthy();
	});

	it('clears dismissed state after recovery so a later failure is announced', async () => {
		const view = renderTree([feed({ syncStatus: 'error', lastSyncError: 'Temporary timeout' })]);
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss feed health summary' }));

		view.rerender(tree([feed()]));
		await waitFor(() => {
			expect(screen.queryByRole('status', { name: '1 feed is not updating' })).toBeNull();
		});
		view.rerender(tree([feed({ syncStatus: 'error', lastSyncError: 'DNS lookup failed' })]));

		expect(screen.getByRole('status', { name: '1 feed is not updating' })).toBeTruthy();
	});

	it('does not show a warning for healthy feeds', () => {
		renderTree([feed()]);

		expect(screen.queryByLabelText(/Phoronix is not updating/)).toBeNull();
	});

	it('does not count a successful partial-sync warning as a broken feed', () => {
		renderTree([
			feed({
				syncStatus: 'idle',
				lastSyncedAt: '2026-07-16T12:00:00.000Z',
				lastSyncError: 'Skipped 1 malformed article item',
				lastSyncErrorAt: '2026-07-16T12:00:00.000Z',
			}),
		]);

		expect(screen.queryByRole('status', { name: '1 feed is not updating' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Show health details for Phoronix' })).toBeTruthy();
		expect(document.getElementById('feed-health-feed-1')?.textContent).toContain(
			'Phoronix updated with a warning',
		);
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
				onReorderCategory={reorderNoop}
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
