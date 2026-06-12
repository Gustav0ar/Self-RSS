import {
	articleQuerySchema,
	markAllReadSchema,
	markReadSchema,
	searchQuerySchema,
} from '@self-feed/shared';
import { Hono } from 'hono';
import type { ArticleService } from '../services/article.service.js';
import { enforceRateLimit, RATE_LIMITS, type RateLimiter } from '../utils/index.js';
import { parseBody, parseQuery, parseUuidParam } from '../utils/validation.js';

export function createArticleRoutes(articleService: ArticleService) {
	const routes = new Hono();

	routes.get('/', async (c) => {
		const userId = c.get('userId');
		const query = parseQuery(c, articleQuerySchema);
		const result = await articleService.getArticles(userId, query);
		return c.json(result);
	});

	routes.get('/:articleId', async (c) => {
		const userId = c.get('userId');
		const articleId = parseUuidParam(c, 'articleId');
		const article = await articleService.getArticle(userId, articleId);

		// ETag = hash of content + read state. Both change on re-fetch
		// (hash) or mark-read (isRead). Client sends back via
		// If-None-Match; if unchanged, 304 avoids transferring the full
		// HTML body — the dominant cost for old, long articles.
		const etag = `"${article.hash ?? article.id}-${article.isRead ? 'r' : 'u'}"`;
		if (c.req.header('If-None-Match') === etag) {
			return c.body(null, 304, { ETag: etag });
		}
		return c.json({ data: article }, 200, { ETag: etag });
	});

	routes.post('/:articleId/enrich', async (c) => {
		const userId = c.get('userId');
		const articleId = parseUuidParam(c, 'articleId');
		const result = await articleService.enrichArticle(userId, articleId);
		return c.json({ data: result });
	});

	routes.patch('/:articleId/read', async (c) => {
		const userId = c.get('userId');
		const articleId = parseUuidParam(c, 'articleId');
		const body = await parseBody(c, markReadSchema);
		const clientId = c.req.header('X-Self-Feed-Client-Id') ?? null;
		const result = await articleService.markRead(
			userId,
			articleId,
			body.read,
			body.source ?? 'manual',
			clientId,
		);
		return c.json({ data: result });
	});

	routes.patch('/mark-all-read', async (c) => {
		const userId = c.get('userId');
		const body = await parseBody(c, markAllReadSchema);
		const clientId = c.req.header('X-Self-Feed-Client-Id') ?? null;
		const result = await articleService.markAllRead(userId, body, clientId);
		return c.json({ data: result });
	});

	return routes;
}

export function createSearchRoutes(articleService: ArticleService, rateLimiter: RateLimiter) {
	const routes = new Hono();

	routes.get('/', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'search', RATE_LIMITS.search);
		const userId = c.get('userId');
		const query = parseQuery(c, searchQuerySchema);
		const result = await articleService.search(
			userId,
			query.q,
			query.categoryId,
			query.limit,
			query.cursor,
		);
		return c.json(result);
	});

	return routes;
}
