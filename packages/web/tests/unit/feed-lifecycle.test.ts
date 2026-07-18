import type { FeedWithCounts } from '@self-feed/shared';
import { describe, expect, it } from 'vitest';
import { presentFeedLifecycle } from '../../src/lib/feed-lifecycle';

const baseFeed = {
	id: 'feed-1',
	userId: 'user-1',
	categoryId: 'category-1',
	title: 'Example',
	siteUrl: null,
	feedUrl: 'https://example.com/feed.xml',
	faviconUrl: null,
	description: null,
	pollingIntervalMinutes: 60,
	lastSyncedAt: null,
	lastSyncError: null,
	lastSyncErrorAt: null,
	syncStatus: 'idle',
	createdAt: '2026-07-18T12:00:00Z',
	updatedAt: '2026-07-18T12:00:00Z',
	unreadCount: 0,
} satisfies FeedWithCounts;

describe('presentFeedLifecycle', () => {
	it('blocks pending and discovery retries while exposing explicit choices', () => {
		expect(presentFeedLifecycle({ ...baseFeed, lifecycleStatus: 'pending' })?.refreshBlocked).toBe(
			true,
		);
		const discovery = presentFeedLifecycle({ ...baseFeed, lifecycleStatus: 'discovery_required' });
		expect(discovery).toMatchObject({ refreshBlocked: true, discoveryRequired: true });
		expect(discovery?.detail).toContain('website');
	});

	it('keeps backoff blocked only until server eligibility', () => {
		const now = Date.parse('2026-07-18T12:00:00Z');
		expect(
			presentFeedLifecycle(
				{ ...baseFeed, lifecycleStatus: 'backoff', nextEligibleFetchAt: '2026-07-18T13:00:00Z' },
				now,
			)?.refreshBlocked,
		).toBe(true);
		expect(
			presentFeedLifecycle(
				{ ...baseFeed, lifecycleStatus: 'backoff', nextEligibleFetchAt: '2026-07-18T11:00:00Z' },
				now,
			)?.refreshBlocked,
		).toBe(false);
	});

	it('states that replacement validation preserves existing articles', () => {
		const replacement = presentFeedLifecycle({
			...baseFeed,
			lifecycleStatus: 'replacement_pending',
		});
		expect(replacement).toMatchObject({ refreshBlocked: true, canCancelReplacement: true });
		expect(replacement?.detail).toContain('Existing articles remain');
	});
});
