import { createFeedSchema, importOpmlSchema, updateFeedSchema } from '@self-feed/shared';
import { Hono } from 'hono';
import type { FeedService } from '../services/feed.service.js';
import type { FeedSyncService } from '../services/feed-sync.service.js';
import type { OpmlExportService } from '../services/opml-export.service.js';
import type { OpmlImportService } from '../services/opml-import.service.js';
import { enforceRateLimit, RATE_LIMITS, type RateLimiter } from '../utils/index.js';
import { createLogger } from '../utils/logger.js';
import { parseBody, parseUuidParam } from '../utils/validation.js';

// OPML import limits. 1 MB is enough for tens of thousands of feed
// entries in a typical export; larger files should be split. The daily
// cap is per-user and rolls over at UTC midnight.
const OPML_IMPORT_MAX_BYTES = 1_048_576; // 1 MiB
const OPML_IMPORT_DAILY_LIMIT = 10;

export function createFeedRoutes(
	feedService: FeedService,
	syncService: FeedSyncService,
	opmlExportService: OpmlExportService,
	opmlImportService: OpmlImportService,
	rateLimiter: RateLimiter,
) {
	const routes = new Hono();

	routes.get('/', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'feeds-read', RATE_LIMITS.feedsRead);
		const userId = c.get('userId');
		const categoryId = new URL(c.req.url).searchParams.get('categoryId');
		const feeds = categoryId
			? await feedService.getByCategory(userId, categoryId)
			: await feedService.getAll(userId);
		return c.json({ data: feeds });
	});

	routes.post('/', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'feed-create', RATE_LIMITS.feedCreate);
		const userId = c.get('userId');
		const body = await parseBody(c, createFeedSchema);
		const feed = await feedService.create(userId, body);
		return c.json(
			{
				data: {
					...feed,
					createdAt: feed.createdAt.toISOString(),
					updatedAt: feed.updatedAt.toISOString(),
					lastSyncedAt: feed.lastSyncedAt?.toISOString() ?? null,
					lastSyncErrorAt: feed.lastSyncErrorAt?.toISOString() ?? null,
				},
			},
			201,
		);
	});

	routes.post('/import/opml', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'feed-import', RATE_LIMITS.feedImport);
		const userId = c.get('userId');

		const formData = await c.req.formData().catch(() => null);
		if (!formData) {
			return c.json(
				{ error: { code: 'BAD_REQUEST', message: 'Invalid multipart form data' } },
				400,
			);
		}

		const file = formData.get('file');
		if (!(file instanceof File)) {
			return c.json({ error: { code: 'BAD_REQUEST', message: 'OPML file is required' } }, 400);
		}
		if (file.size > OPML_IMPORT_MAX_BYTES) {
			return c.json(
				{ error: { code: 'PAYLOAD_TOO_LARGE', message: 'OPML file exceeds maximum size' } },
				413,
			);
		}

		const parsedInput = importOpmlSchema.safeParse({
			filename: file.name,
			content: await file.text(),
		});
		if (!parsedInput.success) {
			return c.json(
				{
					error: {
						code: 'BAD_REQUEST',
						message: 'Validation error',
						details: parsedInput.error.flatten(),
					},
				},
				400,
			);
		}

		// Per-user daily import cap. Reserve the slot only after cheap
		// request validation, release it if import parsing or persistence
		// fails, and keep it only for successful imports.
		const dailyCountKey = `opml-import:${userId}`;
		const dailyCount = await rateLimiter.incrementDailyCount(dailyCountKey);
		if (dailyCount > OPML_IMPORT_DAILY_LIMIT) {
			await rateLimiter.releaseDailyCount(dailyCountKey);
			return c.json(
				{
					error: {
						code: 'TOO_MANY_REQUESTS',
						message: `OPML import daily limit reached (${OPML_IMPORT_DAILY_LIMIT})`,
					},
				},
				429,
			);
		}

		const result = await (async () => {
			try {
				return await opmlImportService.import(
					userId,
					parsedInput.data.filename,
					parsedInput.data.content,
				);
			} catch (error) {
				await rateLimiter.releaseDailyCount(dailyCountKey);
				throw error;
			}
		})();

		if (result.createdFeeds > 0) {
			const logger = createLogger(c.get('requestId'));
			logger.info('Imported OPML feeds will be picked up by the background worker', {
				userId,
				createdFeeds: result.createdFeeds,
			});
		}

		return c.json({ data: result }, 201);
	});

	routes.get('/export/opml', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'feed-export', RATE_LIMITS.feedExport);
		const userId = c.get('userId');
		const result = await opmlExportService.export(userId);
		c.header('Content-Type', 'application/xml; charset=utf-8');
		c.header('Content-Disposition', `attachment; filename="${result.filename}"`);
		return c.body(result.content);
	});

	routes.post('/sync', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'feed-sync-all', RATE_LIMITS.feedSync);
		const userId = c.get('userId');
		const result = await syncService.queueSyncAllFeeds(userId);
		return c.json({ data: result }, 202);
	});

	routes.get('/sync/status', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'feeds-read', RATE_LIMITS.feedsRead);
		const userId = c.get('userId');
		const status = await syncService.getSyncAllFeedsStatus(userId);
		return c.json({ data: status });
	});

	routes.patch('/:feedId', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'feeds-mutate', RATE_LIMITS.feedsMutate);
		const userId = c.get('userId');
		const feedId = parseUuidParam(c, 'feedId');
		const body = await parseBody(c, updateFeedSchema);
		const feed = await feedService.update(userId, feedId, body);
		return c.json({ data: feed });
	});

	routes.delete('/:feedId', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'feeds-mutate', RATE_LIMITS.feedsMutate);
		const userId = c.get('userId');
		const feedId = parseUuidParam(c, 'feedId');
		await feedService.delete(userId, feedId);
		return c.json({ data: { success: true } });
	});

	routes.post('/:feedId/sync', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'feed-sync', RATE_LIMITS.feedSync);
		const userId = c.get('userId');
		const feedId = parseUuidParam(c, 'feedId');
		const result = await syncService.syncFeed(feedId, userId);
		return c.json({ data: result });
	});

	return routes;
}
