import { createServer } from 'node:http';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDeps } from '../../src/config/deps.js';
import { closeDb, getDb } from '../../src/db/client.js';
import { closeRedis, getRedis } from '../../src/db/redis.js';
import { auditLogs } from '../../src/db/schema.js';
import { FeedService } from '../../src/services/feed.service.js';
import { createTokenUtils } from '../../src/utils/tokens.js';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!DATABASE_URL || !REDIS_URL || !JWT_SECRET || !JWT_REFRESH_SECRET) {
	throw new Error(
		'Integration tests require DATABASE_URL, REDIS_URL, JWT_SECRET, and JWT_REFRESH_SECRET',
	);
}

const db = getDb(DATABASE_URL);
const redis = getRedis(REDIS_URL);
const tokenUtils = createTokenUtils(JWT_SECRET, JWT_REFRESH_SECRET, '15m', '7d');
const deps = createDeps(db, redis, tokenUtils, {
	timeoutMs: 5000,
	maxContentLength: 1024 * 1024,
	concurrency: 1,
	allowPrivateHosts: true,
});
const app = createApp(deps, tokenUtils);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function getCookieHeader(response: Response) {
	const cookie = response.headers.get('set-cookie');
	return cookie ? cookie.split(';')[0] : null;
}

async function resetDatabase() {
	db.run(sql.raw('PRAGMA foreign_keys = OFF;'));
	const tables = [
		'audit_logs',
		'sync_runs',
		'article_media',
		'article_reads',
		'articles',
		'feeds',
		'categories',
		'user_metrics_daily',
		'user_preferences',
		'app_settings',
		'users',
	];
	for (const table of tables) {
		db.run(sql.raw(`DELETE FROM ${table};`));
	}
	try {
		db.run(sql.raw('DELETE FROM sqlite_sequence;'));
	} catch (_e) {
		// Ignore if sqlite_sequence does not exist
	}
	db.run(sql.raw('PRAGMA foreign_keys = ON;'));
	await redis.flushall();
}

async function jsonRequest(path: string, init: RequestInit = {}) {
	const response = await app.request(path, init);
	const body = await response.json().catch(() => null);
	return { response, body };
}

async function registerUser(email: string, password = 'password123') {
	return jsonRequest('/api/v1/auth/register', {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ email, password }),
	});
}

async function authedRequest(path: string, token: string, init: RequestInit = {}) {
	return jsonRequest(path, {
		...init,
		headers: {
			...(init.headers ?? {}),
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
	});
}

async function authedFormRequest(path: string, token: string, body: FormData) {
	const response = await app.request(path, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
		},
		body,
	});
	const payload = await response.json().catch(() => null);
	return { response, body: payload };
}

async function startFeedServer(xml: string) {
	const server = createServer((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
		res.end(xml);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Failed to start test RSS server');
	}
	return {
		url: `http://127.0.0.1:${address.port}/feed.xml`,
		async stop() {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}

beforeAll(async () => {
	await redis.connect();
});

beforeEach(async () => {
	await resetDatabase();
});

afterAll(async () => {
	await closeRedis();
	await closeDb();
});

describe('API integration', () => {
	it('covers auth, refresh, logout, registration lock, and admin user creation', async () => {
		await deps.repos.settings.update({ registrationLocked: true });

		const registered = await registerUser('user@example.com');
		expect(registered.response.status).toBe(201);
		expect(registered.body.data.user.email).toBe('user@example.com');
		expect(registered.body.data.user.role).toBe('admin');

		const me = await authedRequest('/api/v1/auth/me', registered.body.data.tokens.accessToken);
		expect(me.response.status).toBe(200);
		expect(me.body.data.email).toBe('user@example.com');
		expect(me.body.data.role).toBe('admin');

		const refreshCookie = getCookieHeader(registered.response);
		expect(refreshCookie).toBeTruthy();

		const refreshed = await jsonRequest('/api/v1/auth/refresh', {
			method: 'POST',
			headers: {
				Cookie: refreshCookie!,
			},
		});
		expect(refreshed.response.status).toBe(200);
		expect(refreshed.body.data.tokens.accessToken).not.toBe(
			registered.body.data.tokens.accessToken,
		);

		const rotatedRefreshCookie = getCookieHeader(refreshed.response);
		expect(rotatedRefreshCookie).toBeTruthy();

		const reusedRefresh = await jsonRequest('/api/v1/auth/refresh', {
			method: 'POST',
			headers: {
				Cookie: refreshCookie!,
			},
		});
		expect(reusedRefresh.response.status).toBe(401);

		const logout = await jsonRequest('/api/v1/auth/logout', {
			method: 'POST',
			headers: {
				Cookie: rotatedRefreshCookie!,
			},
		});
		expect(logout.response.status).toBe(200);

		const revokedRefresh = await jsonRequest('/api/v1/auth/refresh', {
			method: 'POST',
			headers: {
				Cookie: rotatedRefreshCookie!,
			},
		});
		expect(revokedRefresh.response.status).toBe(401);

		const adminToken = registered.body.data.tokens.accessToken;

		const lockRegistration = await authedRequest('/api/v1/admin/settings', adminToken, {
			method: 'PATCH',
			body: JSON.stringify({ registrationLocked: true }),
		});
		expect(lockRegistration.response.status).toBe(200);
		expect(lockRegistration.body.data.registrationLocked).toBe(true);

		const blocked = await registerUser('blocked@example.com');
		expect(blocked.response.status).toBe(403);
		expect(blocked.body.error.message).toContain('Registration is currently closed');

		const createdByAdmin = await authedRequest('/api/v1/admin/users', adminToken, {
			method: 'POST',
			body: JSON.stringify({ email: 'manual@example.com', password: 'password123', role: 'user' }),
		});
		expect(createdByAdmin.response.status).toBe(201);
		expect(createdByAdmin.body.data.email).toBe('manual@example.com');

		const auditLogCounts = await db.select({ count: sql<number>`count(*)` }).from(auditLogs);
		expect(auditLogCounts[0]?.count).toBe(2);
	});

	it('rejects local feed URLs when private hosts are not allowed', async () => {
		const feedService = new FeedService({} as never, {} as never, {} as never, {
			maxContentLength: 1024 * 1024,
			allowPrivateHosts: false,
		});

		await expect(feedService.normalizeFeedUrl('http://127.0.0.1/feed.xml')).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Feed URL must not target a local or private network host',
		});
	});

	it('covers category and feed CRUD plus ownership boundaries', async () => {
		const user1 = await registerUser('owner@example.com');
		const user2 = await registerUser('other@example.com');
		const token1 = user1.body.data.tokens.accessToken;
		const token2 = user2.body.data.tokens.accessToken;
		const feedServer = await startFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
		<rss version="2.0">
			<channel>
				<title>Example Feed</title>
				<link>https://example.com</link>
				<description>Example feed description</description>
				<item>
					<title>Example item</title>
					<link>https://example.com/item</link>
					<guid>example-item</guid>
					<description><![CDATA[<p>Example item body</p>]]></description>
				</item>
			</channel>
		</rss>`);

		try {
			const parentCategory = await authedRequest('/api/v1/categories', token1, {
				method: 'POST',
				body: JSON.stringify({ name: 'Tech' }),
			});
			expect(parentCategory.response.status).toBe(201);

			const childCategory = await authedRequest('/api/v1/categories', token1, {
				method: 'POST',
				body: JSON.stringify({ name: 'Bun', parentCategoryId: parentCategory.body.data.id }),
			});
			expect(childCategory.response.status).toBe(201);
			expect(childCategory.body.data.parentCategoryId).toBe(parentCategory.body.data.id);

			const createFeed = await authedRequest('/api/v1/feeds', token1, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: childCategory.body.data.id,
					feedUrl: feedServer.url,
				}),
			});
			expect(createFeed.response.status).toBe(201);
			expect(createFeed.body.data.title).toBe('Example Feed');

			const duplicateFeed = await authedRequest('/api/v1/feeds', token1, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: childCategory.body.data.id,
					feedUrl: feedServer.url,
				}),
			});
			expect(duplicateFeed.response.status).toBe(409);

			const crossUserFeed = await authedRequest('/api/v1/feeds', token2, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: childCategory.body.data.id,
					feedUrl: 'https://example.com/other.xml',
					title: 'Cross User Feed',
				}),
			});
			expect(crossUserFeed.response.status).toBe(404);

			const unauthorizedUpdate = await authedRequest(
				`/api/v1/categories/${childCategory.body.data.id}`,
				token2,
				{
					method: 'PATCH',
					body: JSON.stringify({ name: 'Nope' }),
				},
			);
			expect(unauthorizedUpdate.response.status).toBe(404);

			const unauthorizedDelete = await authedRequest(
				`/api/v1/feeds/${createFeed.body.data.id}`,
				token2,
				{
					method: 'DELETE',
				},
			);
			expect(unauthorizedDelete.response.status).toBe(404);
		} finally {
			await feedServer.stop();
		}
	});

	it('covers OPML import success, duplicate skipping, and invalid files', async () => {
		const registered = await registerUser('importer@example.com');
		const token = registered.body.data.tokens.accessToken;
		const firstFeedServer = await startFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
		<rss version="2.0"><channel><title>Imported Alpha</title><link>https://example.com/a</link><description>Alpha</description><item><title>Alpha</title><link>https://example.com/a1</link><guid>a1</guid><description><![CDATA[<p>Alpha story</p>]]></description></item></channel></rss>`);
		const secondFeedServer = await startFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
		<rss version="2.0"><channel><title>Imported Beta</title><link>https://example.com/b</link><description>Beta</description><item><title>Beta</title><link>https://example.com/b1</link><guid>b1</guid><description><![CDATA[<p>Beta story</p>]]></description></item></channel></rss>`);

		try {
			const opml = `<?xml version="1.0" encoding="UTF-8"?>
			<opml version="2.0">
				<body>
					<outline text="Engineering">
						<outline text="Frontend">
							<outline text="Imported Alpha" xmlUrl="${firstFeedServer.url}" />
							<outline text="Imported Beta" xmlUrl="${secondFeedServer.url}" />
							<outline text="Imported Alpha Duplicate" xmlUrl="${firstFeedServer.url}" />
						</outline>
					</outline>
				</body>
			</opml>`;

			const formData = new FormData();
			formData.set('file', new File([opml], 'feeds.opml', { type: 'text/xml' }));

			const imported = await authedFormRequest('/api/v1/feeds/import/opml', token, formData);
			expect(imported.response.status).toBe(201);
			expect(imported.body.data.createdCategories).toBe(2);
			expect(imported.body.data.createdFeeds).toBe(2);
			expect(imported.body.data.skippedDuplicates).toBe(1);

			const categories = await authedRequest('/api/v1/categories', token);
			expect(
				categories.body.data.categories.map((category: { name: string }) => category.name),
			).toEqual(expect.arrayContaining(['Engineering', 'Frontend']));

			const feeds = await authedRequest('/api/v1/feeds', token);
			expect(feeds.body.data.map((feed: { title: string }) => feed.title)).toEqual(
				expect.arrayContaining(['Imported Alpha', 'Imported Beta']),
			);

			const badFormData = new FormData();
			badFormData.set('file', new File(['not xml'], 'broken.opml', { type: 'text/xml' }));
			const invalidImport = await authedFormRequest(
				'/api/v1/feeds/import/opml',
				token,
				badFormData,
			);
			expect(invalidImport.response.status).toBe(400);
			expect(invalidImport.body.error.message).toContain('Invalid OPML file');

			const oversizedFormData = new FormData();
			oversizedFormData.set(
				'file',
				new File(['a'.repeat(5_242_881)], 'huge.opml', { type: 'text/xml' }),
			);
			const oversizedImport = await authedFormRequest(
				'/api/v1/feeds/import/opml',
				token,
				oversizedFormData,
			);
			expect(oversizedImport.response.status).toBe(413);
			expect(oversizedImport.body.error.message).toContain('exceeds maximum size');
		} finally {
			await firstFeedServer.stop();
			await secondFeedServer.stop();
		}
	});

	it('returns 400 for malformed UUID route params', async () => {
		const registered = await registerUser('bad-ids@example.com');
		const token = registered.body.data.tokens.accessToken;

		const badArticle = await authedRequest('/api/v1/articles/not-a-uuid', token);
		expect(badArticle.response.status).toBe(400);

		const badFeed = await authedRequest('/api/v1/feeds/not-a-uuid', token, {
			method: 'DELETE',
		});
		expect(badFeed.response.status).toBe(400);

		const badCategory = await authedRequest('/api/v1/categories/not-a-uuid', token, {
			method: 'DELETE',
		});
		expect(badCategory.response.status).toBe(400);
	});

	it('covers feed sync, articles, search, mark read, mark all read, preferences, and stats', async () => {
		const registered = await registerUser('reader@example.com');
		const token = registered.body.data.tokens.accessToken;

		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Testing' }),
		});

		const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
		<rss version="2.0">
			<channel>
				<title>Integration Feed</title>
				<link>https://example.com</link>
				<description>Integration feed description</description>
				<item>
					<title>Alpha Integration Story</title>
					<link>https://example.com/alpha</link>
					<guid>alpha-integration</guid>
					<description><![CDATA[<p>Alpha integration content body.</p>]]></description>
					<pubDate>Wed, 08 Jan 2025 10:00:00 GMT</pubDate>
				</item>
				<item>
					<title>Beta Integration Story</title>
					<link>https://example.com/beta</link>
					<guid>beta-integration</guid>
					<description><![CDATA[<p>Beta integration content body.</p>]]></description>
					<pubDate>Thu, 09 Jan 2025 10:00:00 GMT</pubDate>
				</item>
			</channel>
		</rss>`;

		const feedServer = await startFeedServer(feedXml);
		try {
			const feed = await authedRequest('/api/v1/feeds', token, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: feedServer.url,
					title: 'Integration Feed',
				}),
			});
			expect(feed.response.status).toBe(201);

			const sync = await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, token, {
				method: 'POST',
			});
			expect(sync.response.status).toBe(200);
			expect(sync.body.data.newArticles).toBe(2);

			const feedListAfterSync = await authedRequest('/api/v1/feeds', token);
			expect(feedListAfterSync.response.status).toBe(200);
			expect(feedListAfterSync.body.data[0].unreadCount).toBe(2);

			const articles = await authedRequest(
				`/api/v1/articles?feedId=${feed.body.data.id}&sort=latest&limit=10`,
				token,
			);
			expect(articles.response.status).toBe(200);
			expect(articles.body.data).toHaveLength(2);
			expect(articles.body.data[0].title).toBe('Beta Integration Story');

			const articleId = articles.body.data[0].id;
			const detail = await authedRequest(`/api/v1/articles/${articleId}`, token);
			expect(detail.response.status).toBe(200);
			expect(detail.body.data.contentHtml).toContain('Beta integration content body');
			expect(detail.body.data.canonicalUrl).toBe('https://example.com/beta');

			const search = await authedRequest('/api/v1/search?q=Alpha', token);
			expect(search.response.status).toBe(200);
			expect(search.body.data[0].title).toBe('Alpha Integration Story');

			const markRead = await authedRequest(`/api/v1/articles/${articleId}/read`, token, {
				method: 'PATCH',
				body: JSON.stringify({ read: true }),
			});
			expect(markRead.response.status).toBe(200);

			const feedListAfterMarkRead = await authedRequest('/api/v1/feeds', token);
			expect(feedListAfterMarkRead.response.status).toBe(200);
			expect(feedListAfterMarkRead.body.data[0].unreadCount).toBe(1);

			const unreadOnly = await authedRequest(
				`/api/v1/articles?feedId=${feed.body.data.id}&unreadOnly=true&limit=10`,
				token,
			);
			expect(unreadOnly.body.data).toHaveLength(1);

			const markAll = await authedRequest('/api/v1/articles/mark-all-read', token, {
				method: 'PATCH',
				body: JSON.stringify({ categoryId: category.body.data.id }),
			});
			expect(markAll.response.status).toBe(200);
			expect(markAll.body.data.markedCount).toBe(1);

			const feedListAfterMarkAll = await authedRequest('/api/v1/feeds', token);
			expect(feedListAfterMarkAll.response.status).toBe(200);
			expect(feedListAfterMarkAll.body.data[0].unreadCount).toBe(0);

			const updatedPreferences = await authedRequest('/api/v1/preferences', token, {
				method: 'PATCH',
				body: JSON.stringify({ theme: 'dark', fontFamily: 'Georgia', hideRead: true }),
			});
			expect(updatedPreferences.response.status).toBe(200);
			expect(updatedPreferences.body.data.theme).toBe('dark');
			expect(updatedPreferences.body.data.fontFamily).toBe('Georgia');

			const preferences = await authedRequest('/api/v1/preferences', token);
			expect(preferences.body.data.hideRead).toBe(true);

			const stats = await authedRequest('/api/v1/stats', token);
			expect(stats.response.status).toBe(200);
			expect(stats.body.data.totalFeeds).toBe(1);
			expect(stats.body.data.totalCategories).toBe(1);
			expect(stats.body.data.totalRead).toBe(2);
			expect(stats.body.data.dailyMetrics[0].searchCount).toBeGreaterThanOrEqual(1);
		} finally {
			feedServer.stop();
		}
	});

	it('paginates article lists with a stable cursor', async () => {
		const registered = await registerUser('pagination@example.com');
		const token = registered.body.data.tokens.accessToken;

		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Pagination' }),
		});

		const items = Array.from({ length: 35 }, (_, index) => {
			const storyNumber = 35 - index;
			const publishedAt = new Date(Date.UTC(2026, 0, storyNumber, 12, 0, 0)).toUTCString();
			return `<item>
				<title>Cursor Story ${storyNumber}</title>
				<link>https://example.com/cursor/${storyNumber}</link>
				<guid>cursor-story-${storyNumber}</guid>
				<description><![CDATA[<p>Cursor story ${storyNumber} body.</p>]]></description>
				<pubDate>${publishedAt}</pubDate>
			</item>`;
		}).join('');

		const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
		<rss version="2.0">
			<channel>
				<title>Cursor Feed</title>
				<link>https://example.com/cursor</link>
				<description>Cursor pagination feed</description>
				${items}
			</channel>
		</rss>`;

		const feedServer = await startFeedServer(feedXml);
		try {
			const feed = await authedRequest('/api/v1/feeds', token, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: feedServer.url,
					title: 'Cursor Feed',
				}),
			});
			expect(feed.response.status).toBe(201);

			const sync = await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, token, {
				method: 'POST',
			});
			expect(sync.response.status).toBe(200);
			expect(sync.body.data.newArticles).toBe(35);

			const firstPage = await authedRequest(
				`/api/v1/articles?feedId=${feed.body.data.id}&sort=latest&limit=30`,
				token,
			);
			expect(firstPage.response.status).toBe(200);
			expect(firstPage.body.data).toHaveLength(30);
			expect(firstPage.body.hasMore).toBe(true);
			expect(firstPage.body.data[0].title).toBe('Cursor Story 35');
			expect(firstPage.body.data.at(-1)?.title).toBe('Cursor Story 6');

			const secondPage = await authedRequest(
				`/api/v1/articles?feedId=${feed.body.data.id}&sort=latest&limit=30&cursor=${firstPage.body.cursor}`,
				token,
			);
			expect(secondPage.response.status).toBe(200);
			expect(secondPage.body.data).toHaveLength(5);
			expect(secondPage.body.hasMore).toBe(false);
			expect(secondPage.body.data[0].title).toBe('Cursor Story 5');
			expect(secondPage.body.data.at(-1)?.title).toBe('Cursor Story 1');

			const firstPageIds = new Set(
				firstPage.body.data.map((article: { id: string }) => article.id),
			);
			for (const article of secondPage.body.data as Array<{ id: string }>) {
				expect(firstPageIds.has(article.id)).toBe(false);
			}
		} finally {
			await feedServer.stop();
		}
	});

	it('syncs every feed for the current user from the bulk sync endpoint', async () => {
		const registered = await registerUser('sync-all@example.com');
		const token = registered.body.data.tokens.accessToken;

		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Bulk Sync' }),
		});

		const firstFeedServer = await startFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
		<rss version="2.0">
			<channel>
				<title>First Feed</title>
				<link>https://example.com/first</link>
				<description>First bulk feed</description>
				<item>
					<title>First Story</title>
					<link>https://example.com/first/story</link>
					<guid>first-story</guid>
					<description><![CDATA[<p>First story body.</p>]]></description>
					<pubDate>Wed, 08 Jan 2025 10:00:00 GMT</pubDate>
				</item>
			</channel>
		</rss>`);
		const secondFeedServer = await startFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
		<rss version="2.0">
			<channel>
				<title>Second Feed</title>
				<link>https://example.com/second</link>
				<description>Second bulk feed</description>
				<item>
					<title>Second Story</title>
					<link>https://example.com/second/story</link>
					<guid>second-story</guid>
					<description><![CDATA[<p>Second story body.</p>]]></description>
					<pubDate>Thu, 09 Jan 2025 10:00:00 GMT</pubDate>
				</item>
				<item>
					<title>Third Story</title>
					<link>https://example.com/third/story</link>
					<guid>third-story</guid>
					<description><![CDATA[<p>Third story body.</p>]]></description>
					<pubDate>Fri, 10 Jan 2025 10:00:00 GMT</pubDate>
				</item>
			</channel>
		</rss>`);

		try {
			const firstFeed = await authedRequest('/api/v1/feeds', token, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: firstFeedServer.url,
					title: 'First Feed',
				}),
			});
			expect(firstFeed.response.status).toBe(201);

			const secondFeed = await authedRequest('/api/v1/feeds', token, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: secondFeedServer.url,
					title: 'Second Feed',
				}),
			});
			expect(secondFeed.response.status).toBe(201);

			const sync = await authedRequest('/api/v1/feeds/sync', token, {
				method: 'POST',
			});
			expect(sync.response.status).toBe(202);
			expect(sync.body.data).toEqual({
				accepted: true,
				alreadyQueued: false,
			});

			const queuedResult = await deps.services.feedSync.processNextQueuedSyncAllFeeds();
			expect(queuedResult).toMatchObject({
				userId: registered.body.data.user.id,
				skipped: false,
				result: {
					totalFeeds: 2,
					syncedFeeds: 2,
					failedFeeds: 0,
					skippedFeeds: 0,
					newArticles: 3,
				},
			});

			const feeds = await authedRequest('/api/v1/feeds', token);
			expect(feeds.response.status).toBe(200);
			expect(feeds.body.data).toHaveLength(2);
			expect(
				feeds.body.data.reduce(
					(total: number, feed: { unreadCount: number }) => total + feed.unreadCount,
					0,
				),
			).toBe(3);

			const articles = await authedRequest('/api/v1/articles?sort=latest&limit=10', token);
			expect(articles.response.status).toBe(200);
			expect(articles.body.data).toHaveLength(3);
		} finally {
			await firstFeedServer.stop();
			await secondFeedServer.stop();
		}
	});

	it('covers registration status checking and lock boundaries', async () => {
		// 1. Initial check (no users exist yet): registration status should return enabled: true
		const initialStatus = await jsonRequest('/api/v1/auth/registration-status');
		expect(initialStatus.response.status).toBe(200);
		expect(initialStatus.body.data.registrationEnabled).toBe(true);

		// 2. Register first user (role becomes admin, database is now not empty)
		const firstUser = await registerUser('first@example.com');
		expect(firstUser.response.status).toBe(201);
		const firstToken = firstUser.body.data.tokens.accessToken;

		// 3. Check registration status: should still be true (since registrationLocked defaults to false)
		const statusAfterFirst = await jsonRequest('/api/v1/auth/registration-status');
		expect(statusAfterFirst.response.status).toBe(200);
		expect(statusAfterFirst.body.data.registrationEnabled).toBe(true);

		// 4. Lock registration using admin settings
		const lockResult = await authedRequest('/api/v1/admin/settings', firstToken, {
			method: 'PATCH',
			body: JSON.stringify({ registrationLocked: true }),
		});
		expect(lockResult.response.status).toBe(200);

		// 5. Check registration status: should now return enabled: false (since locked and users exist)
		const statusAfterLock = await jsonRequest('/api/v1/auth/registration-status');
		expect(statusAfterLock.response.status).toBe(200);
		expect(statusAfterLock.body.data.registrationEnabled).toBe(false);

		// 6. Direct registration attempt should be blocked (403)
		const blockedRegister = await registerUser('second@example.com');
		expect(blockedRegister.response.status).toBe(403);
		expect(blockedRegister.body.error.message).toContain('Registration is currently closed');
	});
});
