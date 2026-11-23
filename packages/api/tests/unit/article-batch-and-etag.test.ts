import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/common.js';
import { createArticleRoutes } from '../../src/routes/articles.js';
import { ArticleService } from '../../src/services/article.service.js';
import { jsonWithEtag } from '../../src/utils/etag.js';

const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';

function makeDbDetailRow(id: string) {
	return {
		id,
		feedId: 'feed-1',
		guid: `guid-${id}`,
		canonicalUrl: `https://example.com/${id}`,
		title: `Title ${id}`,
		author: 'Author',
		excerpt: 'Excerpt',
		contentHtml: '<p>Body</p>',
		contentText: 'Body',
		heroImageUrl: null,
		publishedAt: new Date('2026-05-01T10:00:00.000Z'),
		fetchedAt: new Date('2026-05-01T10:05:00.000Z'),
		hash: `hash-${id}`,
		contentStatus: 'full_ready',
		contentVersion: 2,
		enrichmentQueuedAt: null,
		enrichmentAttemptedAt: null,
		enrichedAt: new Date('2026-05-01T10:06:00.000Z'),
		enrichmentError: null,
		feedTitle: 'Feed 1',
		feedFaviconUrl: null,
		feedSiteUrl: 'https://example.com',
		isRead: false,
		isSaved: false,
		readRevision: 1,
		savedRevision: 0,
		media: [],
	};
}

describe('ArticleService.getArticlesByIds', () => {
	it('preserves caller order, deduplicates IDs, merges Redis hits with SQLite state, and reports missing IDs', async () => {
		const cachedPayload = {
			...makeDbDetailRow(UUID_1),
			publishedAt: '2026-05-01T10:00:00.000Z',
			fetchedAt: '2026-05-01T10:05:00.000Z',
			enrichedAt: '2026-05-01T10:06:00.000Z',
			isEnriched: true,
			isRead: false,
			isSaved: false,
		};

		const articleRepo = {
			findStatesForUser: vi.fn(async () => [
				{ id: UUID_1, isRead: true, isSaved: true, readRevision: 4, savedRevision: 2 },
			]),
			findDetailsForUser: vi.fn(async () => [makeDbDetailRow(UUID_2)]),
		};
		const redis = {
			mget: vi.fn(async () => [JSON.stringify(cachedPayload), null, null]),
			setex: vi.fn(async () => 'OK'),
			del: vi.fn(async () => 1),
		};

		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			{} as never,
			redis as never,
		);

		const result = await service.getArticlesByIds('user-1', [UUID_1, UUID_2, UUID_1, UUID_3]);

		expect(result.articles.map((a) => a.id)).toEqual([UUID_1, UUID_2]);
		expect(result.articles[0]).toMatchObject({
			id: UUID_1,
			isRead: true,
			isSaved: true,
			readRevision: 4,
			savedRevision: 2,
		});
		expect(result.articles[1]).toMatchObject({
			id: UUID_2,
			isEnriched: true,
		});
		expect(result.missingIds).toEqual([UUID_3]);
		expect(articleRepo.findDetailsForUser).toHaveBeenCalledWith('user-1', [UUID_2, UUID_3]);
		expect(redis.setex).toHaveBeenCalledOnce();
	});

	it('rejects empty or oversized batches on POST /details and returns Cache-Control: no-store', async () => {
		const articleService = {
			getArticlesByIds: vi.fn(async () => ({ articles: [], missingIds: [UUID_1] })),
		};
		const rateLimiter = {
			check: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: Date.now() + 60_000 })),
		};
		const app = new Hono();
		app.onError(errorHandler);
		app.use('*', async (c, next) => {
			c.set('userId' as never, 'user-1' as never);
			await next();
		});
		app.route('/articles', createArticleRoutes(articleService as never, rateLimiter as never));

		const okRes = await app.request('/articles/details', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ articleIds: [UUID_1] }),
		});
		expect(okRes.status).toBe(200);
		expect(okRes.headers.get('Cache-Control')).toBe('no-store');
		expect(await okRes.json()).toEqual({ data: { articles: [], missingIds: [UUID_1] } });

		const tooManyRes = await app.request('/articles/details', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ articleIds: Array.from({ length: 21 }, () => UUID_1) }),
		});
		expect(tooManyRes.status).toBe(400);
	});
});

describe('jsonWithEtag', () => {
	it('returns a weak ETag on 200 and 304 Not Modified when If-None-Match matches', async () => {
		const app = new Hono();
		app.get('/items', (c) => jsonWithEtag(c, { data: [{ id: '1', name: 'Tech' }] }));

		const first = await app.request('/items');
		expect(first.status).toBe(200);
		const etag = first.headers.get('ETag');
		expect(etag).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
		expect(first.headers.get('Cache-Control')).toBe('private, no-cache');
		expect(await first.json()).toEqual({ data: [{ id: '1', name: 'Tech' }] });

		const second = await app.request('/items', {
			headers: { 'If-None-Match': etag! },
		});
		expect(second.status).toBe(304);
		expect(second.headers.get('ETag')).toBe(etag);
		expect(await second.text()).toBe('');
	});
});
