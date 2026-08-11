import {
	articleDetailQuerySchema,
	articleQuerySchema,
	markAllReadSchema,
	markReadSchema,
	saveArticleSchema,
	searchQuerySchema,
} from '@self-feed/shared';
import { type Context, Hono } from 'hono';
import type { ArticleService } from '../services/article.service.js';
import { enforceRateLimit, RATE_LIMITS, type RateLimiter } from '../utils/index.js';
import { parseBody, parseQuery, parseUuidParam } from '../utils/validation.js';

export function createArticleRoutes(articleService: ArticleService, rateLimiter: RateLimiter) {
	const routes = new Hono();
	const getArticleDetail = async (c: Context, articleId: string) => {
		const userId = c.get('userId');
		const article = await articleService.getArticle(userId, articleId);

		// The representation changes with content, read state, or saved state.
		// (hash) or mark-read (isRead). Client sends back via
		// If-None-Match; if unchanged, 304 avoids transferring the full
		// HTML body — the dominant cost for old, long articles.
		const etag = `"${article.hash ?? article.id}-v${article.contentVersion}-${article.isRead ? 'r' : 'u'}-${article.isSaved ? 's' : 'n'}"`;
		if (c.req.header('If-None-Match') === etag) {
			return c.body(null, 304, { ETag: etag });
		}
		return c.json({ data: article }, 200, { ETag: etag });
	};

	routes.get('/', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'articles-read', RATE_LIMITS.articlesRead);
		const userId = c.get('userId');
		const query = parseQuery(c, articleQuerySchema);
		const result = await articleService.getArticles(userId, query);
		return c.json(result);
	});

	// Keep the UUID out of the path used by first-party clients. CrowdSec's
	// generic crawler scenario counts distinct path segments but ignores query
	// parameters, so rapid, legitimate reader navigation now remains one path.
	routes.get('/detail', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'articles-read', RATE_LIMITS.articlesRead);
		const { id } = parseQuery(c, articleDetailQuerySchema);
		return getArticleDetail(c, id);
	});

	// Backward compatibility for older clients and existing integrations.
	routes.get('/:articleId', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'articles-read', RATE_LIMITS.articlesRead);
		return getArticleDetail(c, parseUuidParam(c, 'articleId'));
	});

	routes.post('/:articleId/enrich', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'article-enrich', RATE_LIMITS.articleEnrich);
		const userId = c.get('userId');
		const articleId = parseUuidParam(c, 'articleId');
		const result = await articleService.enrichArticle(userId, articleId);
		return c.json({ data: result });
	});

	routes.patch('/:articleId/read', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'articles-mutate', RATE_LIMITS.articlesMutate);
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

	routes.patch('/:articleId/saved', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'articles-mutate', RATE_LIMITS.articlesMutate);
		const userId = c.get('userId');
		const articleId = parseUuidParam(c, 'articleId');
		const body = await parseBody(c, saveArticleSchema);
		const result = await articleService.setSaved(userId, articleId, body.saved);
		return c.json({ data: result });
	});

	routes.patch('/mark-all-read', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'articles-mutate', RATE_LIMITS.articlesMutate);
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
