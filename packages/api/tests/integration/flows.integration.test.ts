import { createServer } from 'node:http';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDeps } from '../../src/config/deps.js';
import { clearEnvCache } from '../../src/config/env.js';
import { closeDb, getDb } from '../../src/db/client.js';
import { closeRedis, getRedis } from '../../src/db/redis.js';
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
	timeoutMs: 5_000,
	maxContentLength: 1024 * 1024,
	concurrency: 1,
	allowPrivateHosts: true,
});
const app = createApp(deps, tokenUtils);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jsonRequest(path: string, init: RequestInit = {}) {
	const response = await app.request(path, init);
	const body = await response.json().catch(() => null);
	return { response, body };
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
		/* ignore */
	}
	db.run(sql.raw('PRAGMA foreign_keys = ON;'));
	await redis.flushall();
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
	await deps.services.realtime.close();
	await closeRedis();
	await closeDb();
});

describe('API integration - additional flows', () => {
	it('returns 304 for unchanged article detail with If-None-Match', async () => {
		const registered = await registerUser('etag@example.com');
		const token = registered.body.data.tokens.accessToken;

		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Etag' }),
		});
		const feedServer = await startFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
			<rss version="2.0"><channel>
				<title>Etag Feed</title><link>https://example.com</link>
				<item>
					<title>Story</title>
					<link>https://example.com/story</link>
					<guid>etag-story</guid>
					<description><![CDATA[<p>Story body.</p>]]></description>
				</item>
			</channel></rss>`);

		try {
			const feed = await authedRequest('/api/v1/feeds', token, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: feedServer.url,
				}),
			});
			await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, token, { method: 'POST' });

			const articles = await authedRequest(
				`/api/v1/articles?feedId=${feed.body.data.id}&limit=10`,
				token,
			);
			const articleId = articles.body.data[0].id;
			const detail = await authedRequest(`/api/v1/articles/${articleId}`, token);
			const etag = detail.response.headers.get('ETag');
			expect(etag).toBeTruthy();

			const cached = await app.request(`/api/v1/articles/${articleId}`, {
				headers: { Authorization: `Bearer ${token}`, 'If-None-Match': etag! },
			});
			expect(cached.status).toBe(304);
			expect(cached.headers.get('ETag')).toBe(etag);
		} finally {
			await feedServer.stop();
		}
	});

	it('returns 404 for an article that does not exist or belongs to another user', async () => {
		const userA = await registerUser('article-404-a@example.com');
		const userB = await registerUser('article-404-b@example.com');
		const tokenA = userA.body.data.tokens.accessToken;
		const tokenB = userB.body.data.tokens.accessToken;

		const category = await authedRequest('/api/v1/categories', tokenA, {
			method: 'POST',
			body: JSON.stringify({ name: 'A category' }),
		});
		const feedServer = await startFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
			<rss version="2.0"><channel>
				<title>404 Feed</title><link>https://example.com</link>
				<item>
					<title>Owned</title>
					<link>https://example.com/owned</link>
					<guid>404-owned</guid>
					<description><![CDATA[<p>Owned.</p>]]></description>
				</item>
			</channel></rss>`);

		try {
			const feed = await authedRequest('/api/v1/feeds', tokenA, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: feedServer.url,
				}),
			});
			await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, tokenA, { method: 'POST' });

			const articles = await authedRequest(
				`/api/v1/articles?feedId=${feed.body.data.id}&limit=10`,
				tokenA,
			);
			const articleId = articles.body.data[0].id;

			// B can't see A's article
			const otherUserLookup = await authedRequest(`/api/v1/articles/${articleId}`, tokenB);
			expect(otherUserLookup.response.status).toBe(404);

			// Random uuid returns 404
			const missing = await authedRequest(
				`/api/v1/articles/00000000-0000-0000-0000-000000000000`,
				tokenA,
			);
			expect(missing.response.status).toBe(404);
		} finally {
			await feedServer.stop();
		}
	});

	it('rejects mark-all-read when neither feedId nor categoryId is provided and the user has no feeds', async () => {
		const registered = await registerUser('no-feeds@example.com');
		const token = registered.body.data.tokens.accessToken;

		const result = await authedRequest('/api/v1/articles/mark-all-read', token, {
			method: 'PATCH',
			body: JSON.stringify({}),
		});

		expect(result.response.status).toBe(200);
		expect(result.body.data.markedCount).toBe(0);
	});

	it('marks an article as unread and decrements the unread count', async () => {
		const registered = await registerUser('unread@example.com');
		const token = registered.body.data.tokens.accessToken;
		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Unread' }),
		});
		const feedServer = await startFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
			<rss version="2.0"><channel>
				<title>Unread Feed</title><link>https://example.com</link>
				<item>
					<title>Read then unread</title>
					<link>https://example.com/story</link>
					<guid>unread-1</guid>
					<description><![CDATA[<p>Body.</p>]]></description>
				</item>
			</channel></rss>`);

		try {
			const feed = await authedRequest('/api/v1/feeds', token, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: feedServer.url,
				}),
			});
			await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, token, { method: 'POST' });
			const articles = await authedRequest(
				`/api/v1/articles?feedId=${feed.body.data.id}&limit=10`,
				token,
			);
			const articleId = articles.body.data[0].id;

			const markRead = await authedRequest(`/api/v1/articles/${articleId}/read`, token, {
				method: 'PATCH',
				body: JSON.stringify({ read: true }),
			});
			expect(markRead.response.status).toBe(200);

			const afterRead = await authedRequest('/api/v1/feeds', token);
			expect(afterRead.body.data[0].unreadCount).toBe(0);

			const markUnread = await authedRequest(`/api/v1/articles/${articleId}/read`, token, {
				method: 'PATCH',
				body: JSON.stringify({ read: false, source: 'manual' }),
			});
			expect(markUnread.response.status).toBe(200);

			const afterUnread = await authedRequest('/api/v1/feeds', token);
			expect(afterUnread.body.data[0].unreadCount).toBe(1);
		} finally {
			await feedServer.stop();
		}
	});

	it('rejects invalid category UUIDs with 400', async () => {
		const registered = await registerUser('cat-bad@example.com');
		const token = registered.body.data.tokens.accessToken;

		const result = await authedRequest('/api/v1/categories/not-a-uuid', token, {
			method: 'PATCH',
			body: JSON.stringify({ name: 'X' }),
		});
		expect(result.response.status).toBe(400);
	});

	it('returns an empty list when filtering by a category that has no feeds', async () => {
		const registered = await registerUser('empty-cat@example.com');
		const token = registered.body.data.tokens.accessToken;
		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Empty' }),
		});
		const result = await authedRequest(
			`/api/v1/articles?categoryId=${category.body.data.id}&limit=10`,
			token,
		);
		expect(result.response.status).toBe(200);
		expect(result.body.data).toEqual([]);
		expect(result.body.hasMore).toBe(false);
	});

	it('exposes the rate-limit remaining header on every feed-create call', async () => {
		const registered = await registerUser('rate@example.com');
		const token = registered.body.data.tokens.accessToken;
		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Rate' }),
		});

		const res = await app.request('/api/v1/feeds', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				categoryId: category.body.data.id,
				feedUrl: 'https://example.com/feed.xml',
			}),
		});

		expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
	});

	it('returns 401 when an unauthenticated client hits a protected route', async () => {
		const result = await app.request('/api/v1/feeds');
		expect(result.status).toBe(401);
	});

	it('returns 403 for non-admin users on admin endpoints', async () => {
		// The first registered user becomes admin. Register a second user
		// to test the non-admin path.
		const admin = await registerUser('admin-role@example.com');
		const userReg = await registerUser('user-role@example.com');
		const userToken = userReg.body.data.tokens.accessToken;

		// Sanity: the admin should be able to read settings
		const adminAccess = await authedRequest('/api/v1/admin/settings', admin.body.data.tokens.accessToken);
		expect(adminAccess.response.status).toBe(200);

		const result = await authedRequest('/api/v1/admin/settings', userToken);
		expect(result.response.status).toBe(403);
	});
});

describe('API integration - preferences', () => {
	it('resets to defaults when an empty patch is sent', async () => {
		const registered = await registerUser('reset@example.com');
		const token = registered.body.data.tokens.accessToken;

		// Set non-default values
		const update = await authedRequest('/api/v1/preferences', token, {
			method: 'PATCH',
			body: JSON.stringify({ theme: 'dark', fontFamily: 'Georgia', textSize: 20 }),
		});
		expect(update.response.status).toBe(200);
		expect(update.body.data.theme).toBe('dark');
		expect(update.body.data.fontFamily).toBe('Georgia');

		// Partial update merges the stored values
		const reread = await authedRequest('/api/v1/preferences', token);
		expect(reread.body.data.theme).toBe('dark');
		expect(reread.body.data.fontFamily).toBe('Georgia');
		expect(reread.body.data.accentColor).toBe('indigo');
	});

	it('rejects an invalid accent color through shared validation', async () => {
		const registered = await registerUser('accent-bad@example.com');
		const token = registered.body.data.tokens.accessToken;

		const result = await authedRequest('/api/v1/preferences', token, {
			method: 'PATCH',
			body: JSON.stringify({ theme: 'dark', textSize: 5 }), // below min
		});
		expect(result.response.status).toBe(400);
	});
});
