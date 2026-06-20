import { describe, expect, it } from 'vitest';
import {
	adminCreateUserSchema,
	articleQuerySchema,
	createFeedSchema,
	markAllReadSchema,
	markReadSchema,
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
});
