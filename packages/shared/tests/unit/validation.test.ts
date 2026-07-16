import { describe, expect, it } from 'vitest';
import {
	adminCreateUserSchema,
	articleQuerySchema,
	createFeedSchema,
	markAllReadSchema,
	markReadSchema,
	readStateSyncEventSchema,
	updateFeedSchema,
	updatePreferencesSchema,
} from '../../src/index.js';

const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';

describe('shared validation contracts', () => {
	it('parses article query defaults and string query parameters', () => {
		expect(articleQuerySchema.parse({})).toEqual({
			sort: 'latest',
			limit: 20,
		});
		expect(
			articleQuerySchema.parse({
				feedId: uuidA,
				unreadOnly: 'true',
				sort: 'oldest',
				limit: '50',
			}),
		).toEqual({
			feedId: uuidA,
			unreadOnly: true,
			sort: 'oldest',
			limit: 50,
		});
		expect(articleQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
	});

	it('enforces mutually exclusive bulk mark-read scopes', () => {
		expect(markAllReadSchema.parse({ categoryId: uuidA })).toEqual({ categoryId: uuidA });
		expect(
			markAllReadSchema.safeParse({
				categoryId: uuidA,
				feedId: uuidB,
			}).success,
		).toBe(false);
	});

	it('defaults mark-read source and rejects invalid source values', () => {
		expect(markReadSchema.parse({ read: true })).toEqual({
			read: true,
			source: 'manual',
		});
		expect(markReadSchema.safeParse({ read: true, source: 'bulk' }).success).toBe(false);
	});

	it('validates feed creation input', () => {
		expect(
			createFeedSchema.parse({
				categoryId: uuidA,
				feedUrl: 'https://example.com/feed.xml',
				title: 'Example',
			}),
		).toEqual({
			categoryId: uuidA,
			feedUrl: 'https://example.com/feed.xml',
			title: 'Example',
		});
		expect(createFeedSchema.safeParse({ categoryId: uuidA, feedUrl: 'not-a-url' }).success).toBe(
			false,
		);
	});

	it('validates an optional feed URL update', () => {
		expect(updateFeedSchema.parse({ feedUrl: 'https://example.com/new.xml' })).toEqual({
			feedUrl: 'https://example.com/new.xml',
		});
		expect(updateFeedSchema.safeParse({ feedUrl: 'not-a-url' }).success).toBe(false);
	});

	it('validates preference updates without requiring every setting', () => {
		expect(
			updatePreferencesSchema.parse({
				textSize: 18,
				accentColor: 'emerald',
				autoMarkReadMode: 'on_open',
			}),
		).toEqual({
			textSize: 18,
			accentColor: 'emerald',
			autoMarkReadMode: 'on_open',
		});
		expect(updatePreferencesSchema.safeParse({ textSize: 99 }).success).toBe(false);
		expect(updatePreferencesSchema.safeParse({ accentColor: 'blue' }).success).toBe(false);
	});

	it('defaults admin-created users to the regular user role', () => {
		expect(
			adminCreateUserSchema.parse({
				email: 'reader@example.com',
				password: 'password123',
			}),
		).toEqual({
			email: 'reader@example.com',
			password: 'password123',
			role: 'user',
		});
		expect(
			adminCreateUserSchema.safeParse({
				email: 'reader@example.com',
				password: 'short',
			}).success,
		).toBe(false);
	});

	it('validates article content completion events', () => {
		expect(
			readStateSyncEventSchema.parse({
				type: 'article.updated',
				eventId: uuidA,
				articleId: uuidB,
				feedId: uuidA,
				contentStatus: 'full_ready',
				contentVersion: 2,
				updatedAt: '2026-07-11T12:00:00.000Z',
			}),
		).toMatchObject({ type: 'article.updated', contentVersion: 2 });
	});

	it('validates feed sync progress and health events', () => {
		expect(
			readStateSyncEventSchema.parse({
				type: 'feed.sync.progress',
				eventId: uuidA,
				jobId: uuidB,
				phase: 'running',
				scope: { feedId: uuidA },
				totalFeeds: 1,
				completedFeeds: 0,
				syncedFeeds: 0,
				failedFeeds: 0,
				skippedFeeds: 0,
				newArticles: 0,
				queuedAt: '2026-07-16T12:00:00.000Z',
				startedAt: '2026-07-16T12:00:01.000Z',
				error: null,
				updatedAt: '2026-07-16T12:00:01.000Z',
			}),
		).toMatchObject({ type: 'feed.sync.progress', phase: 'running' });

		expect(
			readStateSyncEventSchema.parse({
				type: 'feed.health.updated',
				eventId: uuidA,
				feedId: uuidB,
				severity: 'error',
				syncStatus: 'error',
				lastSyncedAt: null,
				lastSyncError: 'Publisher timed out',
				lastSyncErrorAt: '2026-07-16T12:00:02.000Z',
				updatedAt: '2026-07-16T12:00:02.000Z',
			}),
		).toMatchObject({ type: 'feed.health.updated', severity: 'error' });
	});
});
