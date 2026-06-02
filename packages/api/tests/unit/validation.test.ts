import {
	articleQuerySchema,
	markAllReadSchema,
	markReadSchema,
	searchQuerySchema,
} from '@self-feed/shared';
import { describe, expect, it } from 'vitest';
import { parseUuidParam } from '../../src/utils/validation.js';

describe('articleQuerySchema', () => {
	it('accepts valid query with defaults', () => {
		const result = articleQuerySchema.parse({});
		expect(result.sort).toBe('latest');
		expect(result.limit).toBe(20);
	});

	it('accepts valid query with all fields', () => {
		const result = articleQuerySchema.parse({
			feedId: '550e8400-e29b-41d4-a716-446655440000',
			categoryId: '550e8400-e29b-41d4-a716-446655440001',
			unreadOnly: 'true',
			sort: 'oldest',
			limit: '50',
			cursor: 'abc123',
		});
		expect(result.unreadOnly).toBe(true);
		expect(result.sort).toBe('oldest');
		expect(result.limit).toBe(50);
	});

	it('rejects invalid UUID for feedId', () => {
		const result = articleQuerySchema.safeParse({ feedId: 'not-uuid' });
		expect(result.success).toBe(false);
	});

	it('rejects limit above 100', () => {
		const result = articleQuerySchema.safeParse({ limit: '200' });
		expect(result.success).toBe(false);
	});

	it('rejects invalid sort value', () => {
		const result = articleQuerySchema.safeParse({ sort: 'random' });
		expect(result.success).toBe(false);
	});
});

describe('markReadSchema', () => {
	it('accepts valid read:true', () => {
		const result = markReadSchema.parse({ read: true });
		expect(result.read).toBe(true);
		expect(result.source).toBe('manual');
	});

	it('accepts valid read with source', () => {
		const result = markReadSchema.parse({ read: false, source: 'auto_navigate' });
		expect(result.read).toBe(false);
		expect(result.source).toBe('auto_navigate');
	});

	it('rejects missing read field', () => {
		const result = markReadSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	it('rejects invalid source', () => {
		const result = markReadSchema.safeParse({ read: true, source: 'invalid' });
		expect(result.success).toBe(false);
	});
});

describe('markAllReadSchema', () => {
	it('accepts empty body', () => {
		const result = markAllReadSchema.parse({});
		expect(result.feedId).toBeUndefined();
		expect(result.categoryId).toBeUndefined();
	});

	it('accepts valid feedId', () => {
		const result = markAllReadSchema.parse({
			feedId: '550e8400-e29b-41d4-a716-446655440000',
		});
		expect(result.feedId).toBe('550e8400-e29b-41d4-a716-446655440000');
	});

	it('rejects invalid UUID', () => {
		const result = markAllReadSchema.safeParse({ feedId: 'bad' });
		expect(result.success).toBe(false);
	});
});

describe('searchQuerySchema', () => {
	it('accepts valid search query', () => {
		const result = searchQuerySchema.parse({ q: 'hello world' });
		expect(result.q).toBe('hello world');
		expect(result.limit).toBe(20);
	});

	it('rejects empty query', () => {
		const result = searchQuerySchema.safeParse({ q: '' });
		expect(result.success).toBe(false);
	});

	it('accepts query with category filter', () => {
		const result = searchQuerySchema.parse({
			q: 'test',
			categoryId: '550e8400-e29b-41d4-a716-446655440000',
		});
		expect(result.categoryId).toBe('550e8400-e29b-41d4-a716-446655440000');
	});

	it('rejects query exceeding max length', () => {
		const result = searchQuerySchema.safeParse({ q: 'x'.repeat(501) });
		expect(result.success).toBe(false);
	});
});

describe('parseUuidParam', () => {
	it('returns valid UUID params', () => {
		const value = parseUuidParam(
			{
				req: {
					param: () => '550e8400-e29b-41d4-a716-446655440000',
				},
			} as never,
			'feedId',
		);
		expect(value).toBe('550e8400-e29b-41d4-a716-446655440000');
	});

	it('rejects malformed UUID params', () => {
		expect(() =>
			parseUuidParam(
				{
					req: {
						param: () => 'not-a-uuid',
					},
				} as never,
				'feedId',
			),
		).toThrowError('Validation error');
	});
});
