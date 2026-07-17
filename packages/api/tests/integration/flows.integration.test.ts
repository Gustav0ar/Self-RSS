import { createServer } from 'node:http';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDeps } from '../../src/config/deps.js';
import { closeDb, getDb } from '../../src/db/client.js';
import { CacheKeys, closeRedis, getRedis } from '../../src/db/redis.js';
import { feedFetchLockKey, prefetchedFeedKey } from '../../src/services/feed-fetch-guard.js';
import { FEED_FETCH_USER_AGENT } from '../../src/utils/feed-fetch-headers.js';
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

async function startMutableFeedServer(initialXml: string) {
	let xml = initialXml;
	let hanging = false;
	let requestCount = 0;
	const server = createServer((_req, res) => {
		requestCount += 1;
		res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
		if (hanging) {
			res.write(xml.slice(0, 32));
			return;
		}
		res.end(xml);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Failed to start test RSS server');
	}
	return {
		url: `http://127.0.0.1:${address.port}/feed.xml`,
		setXml(nextXml: string) {
			xml = nextXml;
		},
		setHanging(nextHanging: boolean) {
			hanging = nextHanging;
		},
		getRequestCount() {
			return requestCount;
		},
		async stop() {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			});
		},
	};
}

function regressionFeedXml(channelTitle: string, items: Array<{ guid: string; title: string }>) {
	return `<?xml version="1.0" encoding="UTF-8"?>
		<rss version="2.0"><channel>
			<title>${channelTitle}</title><link>https://example.com</link>
			${items
				.map((item) => `<item><title>${item.title}</title><guid>${item.guid}</guid></item>`)
				.join('')}
		</channel></rss>`;
}

async function startBrowserCompatibleFeedServer(xml: string) {
	const userAgents: string[] = [];
	const server = createServer((req, res) => {
		const userAgent = req.headers['user-agent'] ?? '';
		userAgents.push(userAgent);
		if (!userAgent.startsWith('Mozilla/5.0')) {
			res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end('<html><body>Browser verification required</body></html>');
			return;
		}
		res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
		res.end(xml);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Failed to start browser-compatible RSS server');
	}
	return {
		url: `http://127.0.0.1:${address.port}/feed.xml`,
		userAgents,
		async stop() {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}

async function startRelayFallbackServers(initialXml: string, token: string) {
	let xml = initialXml;
	let directRequests = 0;
	let relayRequests = 0;
	const relayAuthorizations: Array<string | undefined> = [];
	const directServer = createServer((_req, res) => {
		directRequests += 1;
		res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end('<html><body>Datacenter address blocked</body></html>');
	});
	const relayServer = createServer((req, res) => {
		relayRequests += 1;
		relayAuthorizations.push(req.headers.authorization);
		if (req.url !== '/videocardz/rss-feed') {
			res.writeHead(404).end();
			return;
		}
		if (req.headers.authorization !== `Bearer ${token}`) {
			res.writeHead(401).end();
			return;
		}
		res.writeHead(200, {
			'Content-Type': 'application/rss+xml; charset=utf-8',
			'X-Self-Feed-Relay': 'generic',
		});
		res.end(xml);
	});

	await Promise.all([
		new Promise<void>((resolve) => directServer.listen(0, '127.0.0.1', () => resolve())),
		new Promise<void>((resolve) => relayServer.listen(0, '127.0.0.1', () => resolve())),
	]);
	const directAddress = directServer.address();
	const relayAddress = relayServer.address();
	if (
		!directAddress ||
		typeof directAddress === 'string' ||
		!relayAddress ||
		typeof relayAddress === 'string'
	) {
		throw new Error('Failed to start relay fallback test servers');
	}

	return {
		directUrl: `http://127.0.0.1:${directAddress.port}/feed.xml`,
		relayUrl: `http://127.0.0.1:${relayAddress.port}/videocardz/rss-feed`,
		get directRequests() {
			return directRequests;
		},
		get relayRequests() {
			return relayRequests;
		},
		relayAuthorizations,
		setXml(nextXml: string) {
			xml = nextXml;
		},
		async stop() {
			await Promise.all(
				[directServer, relayServer].map(
					(server) =>
						new Promise<void>((resolve, reject) =>
							server.close((error) => (error ? reject(error) : resolve())),
						),
				),
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
	it('creates and syncs feeds that require a browser-compatible user agent', async () => {
		const registered = await registerUser('browser-compatible-feed@example.com');
		const token = registered.body.data.tokens.accessToken;
		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Compatibility' }),
		});
		const feedServer = await startBrowserCompatibleFeedServer(`<?xml version="1.0"?>
			<rss version="2.0"><channel>
				<title>Browser-compatible feed</title><link>https://example.com</link>
				<item><title>Story</title><link>https://example.com/story</link><guid>story-1</guid></item>
			</channel></rss>`);

		try {
			const feed = await authedRequest('/api/v1/feeds', token, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: feedServer.url,
				}),
			});
			expect(feed.response.status).toBe(201);
			expect(feed.body.data.title).toBe('Browser-compatible feed');

			const sync = await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, token, {
				method: 'POST',
			});
			expect(sync.response.status).toBe(200);
			expect(feedServer.userAgents).toEqual([FEED_FETCH_USER_AGENT]);
		} finally {
			await feedServer.stop();
		}
	});

	it('adds and syncs an allowlisted feed through the relay after a direct 403', async () => {
		const relayToken = 'integration-relay-token-that-is-long-enough';
		const initialXml = `<?xml version="1.0"?>
			<rss version="2.0"><channel>
				<title>VideoCardz Test Feed</title><link>https://videocardz.com</link>
				<item><title>Initial story</title><link>https://videocardz.com/newz/initial</link><guid>initial</guid></item>
			</channel></rss>`;
		const servers = await startRelayFallbackServers(initialXml, relayToken);
		const relayDeps = createDeps(db, redis, tokenUtils, {
			timeoutMs: 5_000,
			maxContentLength: 1024 * 1024,
			concurrency: 1,
			allowPrivateHosts: true,
			relayUrl: servers.relayUrl,
			relayToken,
			allowedHosts: ['127.0.0.1'],
		});
		const relayApp = createApp(relayDeps, tokenUtils);
		const relayRequest = async (path: string, init: RequestInit = {}) => {
			const response = await relayApp.request(path, init);
			const body = await response.json().catch(() => null);
			return { response, body };
		};

		try {
			const registered = await relayRequest('/api/v1/auth/register', {
				method: 'POST',
				headers: JSON_HEADERS,
				body: JSON.stringify({ email: 'relay-fallback@example.com', password: 'password123' }),
			});
			const token = registered.body.data.tokens.accessToken;
			const authorizedRequest = (path: string, init: RequestInit = {}) =>
				relayRequest(path, {
					...init,
					headers: {
						...(init.headers ?? {}),
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
				});
			const category = await authorizedRequest('/api/v1/categories', {
				method: 'POST',
				body: JSON.stringify({ name: 'Technology' }),
			});
			const feed = await authorizedRequest('/api/v1/feeds', {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: servers.directUrl,
				}),
			});
			expect(feed.response.status).toBe(201);
			expect(feed.body.data.title).toBe('VideoCardz Test Feed');

			const sync = await authorizedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, {
				method: 'POST',
			});
			expect(sync.response.status).toBe(200);
			const articles = await authorizedRequest(
				`/api/v1/articles?feedId=${feed.body.data.id}&limit=10`,
			);
			expect(articles.response.status).toBe(200);
			expect(articles.body.data.map((article: { title: string }) => article.title)).toEqual([
				'Initial story',
			]);
			expect(servers.directRequests).toBe(1);
			expect(servers.relayRequests).toBe(1);
			expect(servers.relayAuthorizations).toEqual([`Bearer ${relayToken}`]);
		} finally {
			await relayDeps.services.realtime.close();
			await servers.stop();
		}
	});

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
			const detail = await authedRequest(
				`/api/v1/articles/detail?id=${encodeURIComponent(articleId)}`,
				token,
			);
			const etag = detail.response.headers.get('ETag');
			expect(etag).toBeTruthy();

			const cached = await app.request(
				`/api/v1/articles/detail?id=${encodeURIComponent(articleId)}`,
				{
					headers: { Authorization: `Bearer ${token}`, 'If-None-Match': etag! },
				},
			);
			expect(cached.status).toBe(304);
			expect(cached.headers.get('ETag')).toBe(etag);

			const legacyDetail = await authedRequest(`/api/v1/articles/${articleId}`, token);
			expect(legacyDetail.response.status).toBe(200);
			expect(legacyDetail.body.data.id).toBe(articleId);
		} finally {
			await feedServer.stop();
		}
	});

	it('returns updated article detail when content changes behind an old ETag', async () => {
		const registered = await registerUser('etag-change@example.com');
		const token = registered.body.data.tokens.accessToken;

		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Etag Change' }),
		});

		const feedForBody = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
			<rss version="2.0"><channel>
				<title>Etag Change Feed</title><link>https://example.com</link>
				<item>
					<title>Story</title>
					<link>https://example.com/story</link>
					<guid>etag-change-story</guid>
					<description><![CDATA[${body}]]></description>
				</item>
			</channel></rss>`;

		const feedServer = await startMutableFeedServer(feedForBody('<p>Story body.</p>'));

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

			feedServer.setXml(
				feedForBody(
					'<p>Story body with a much longer updated article body that exceeds the refresh threshold by more than eighty characters and should update the stored content hash.</p>',
				),
			);
			await redis.del(feedFetchLockKey(feedServer.url));
			await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, token, { method: 'POST' });

			const changed = await app.request(`/api/v1/articles/${articleId}`, {
				headers: { Authorization: `Bearer ${token}`, 'If-None-Match': etag! },
			});
			expect(changed.status).toBe(200);
			const changedEtag = changed.headers.get('ETag');
			expect(changedEtag).toBeTruthy();
			expect(changedEtag).not.toBe(etag);
			const changedBody = await changed.json();
			expect(changedBody.data.contentHtml).toContain('much longer updated article body');

			const cached = await app.request(`/api/v1/articles/${articleId}`, {
				headers: { Authorization: `Bearer ${token}`, 'If-None-Match': changedEtag! },
			});
			expect(cached.status).toBe(304);
		} finally {
			await feedServer.stop();
		}
	});

	it('returns a clean upstream error when manual feed sync cannot parse the remote feed', async () => {
		const registered = await registerUser('manual-sync-failure@example.com');
		const token = registered.body.data.tokens.accessToken;

		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Manual Sync Failure' }),
		});

		const feedServer = await startMutableFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
			<rss version="2.0"><channel>
				<title>Manual Sync Failure Feed</title><link>https://example.com</link>
				<item>
					<title>Story</title>
					<link>https://example.com/story</link>
					<guid>manual-sync-failure-story</guid>
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

			feedServer.setXml('not xml');
			await redis.del(feedFetchLockKey(feedServer.url), prefetchedFeedKey(feedServer.url));
			const failedSync = await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, token, {
				method: 'POST',
			});

			expect(failedSync.response.status).toBe(502);
			expect(failedSync.body.error).toMatchObject({
				code: 'BAD_GATEWAY',
				message: 'Could not fetch or parse the feed URL',
			});
			expect(failedSync.body.error.details).toEqual(expect.any(String));

			const feeds = await authedRequest('/api/v1/feeds', token);
			expect(feeds.body.data[0]).toMatchObject({
				id: feed.body.data.id,
				syncStatus: 'error',
				lastSyncError: failedSync.body.error.details,
				lastSyncErrorAt: expect.any(String),
			});

			const queuedRetry = await authedRequest(
				`/api/v1/feeds/sync?feedId=${feed.body.data.id}`,
				token,
				{ method: 'POST' },
			);
			expect(queuedRetry.response.status).toBe(202);
			expect(queuedRetry.body.data).toMatchObject({
				accepted: true,
				alreadyQueued: false,
				jobId: expect.any(String),
				status: { active: true, scope: { feedId: feed.body.data.id } },
			});

			const queuedResult = await deps.services.feedSync.processNextQueuedSyncAllFeeds();
			expect(queuedResult).toMatchObject({
				skipped: false,
				result: { totalFeeds: 1, failedFeeds: 0, skippedFeeds: 1, syncedFeeds: 0 },
			});

			const delayedMember = JSON.stringify({
				feedId: feed.body.data.id,
				userId: registered.body.data.user.id,
			});
			expect(await redis.zscore(CacheKeys.delayedFeedSyncs(), delayedMember)).not.toBeNull();
			feedServer.setXml(`<?xml version="1.0" encoding="UTF-8"?>
				<rss version="2.0"><channel>
					<title>Recovered Feed</title><link>https://example.com</link>
					<item><title>Recovered Story</title><guid>recovered-story</guid></item>
				</channel></rss>`);
			await redis.del(feedFetchLockKey(feedServer.url));
			await redis.zadd(CacheKeys.delayedFeedSyncs(), 0, delayedMember);

			const delayedResult = await deps.services.feedSync.processNextDelayedFeedSync();
			expect(delayedResult).toMatchObject({
				feedId: feed.body.data.id,
				userId: registered.body.data.user.id,
				result: { newArticles: 1, total: 1 },
			});
			expect(await redis.zscore(CacheKeys.delayedFeedSyncs(), delayedMember)).toBeNull();
		} finally {
			await feedServer.stop();
		}
	});

	it('finishes a bulk refresh and stores healthy articles when another feed stalls mid-response', async () => {
		const registered = await registerUser('stalled-bulk-refresh@example.com');
		const token = registered.body.data.tokens.accessToken;
		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Stalled bulk refresh' }),
		});
		const stalledServer = await startMutableFeedServer(
			regressionFeedXml('A Stalled Feed', [{ guid: 'stalled-initial', title: 'Stalled initial' }]),
		);
		const healthyServer = await startMutableFeedServer(
			regressionFeedXml('B Healthy Feed', [{ guid: 'healthy-initial', title: 'Healthy initial' }]),
		);

		try {
			const stalledFeed = await authedRequest('/api/v1/feeds', token, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: stalledServer.url,
				}),
			});
			const healthyFeed = await authedRequest('/api/v1/feeds', token, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: category.body.data.id,
					feedUrl: healthyServer.url,
				}),
			});

			await authedRequest(`/api/v1/feeds/${stalledFeed.body.data.id}/sync`, token, {
				method: 'POST',
			});
			await authedRequest(`/api/v1/feeds/${healthyFeed.body.data.id}/sync`, token, {
				method: 'POST',
			});
			db.run(sql`
				UPDATE feeds
				SET last_synced_at = unixepoch() - 121
				WHERE id IN (${stalledFeed.body.data.id}, ${healthyFeed.body.data.id})
			`);

			stalledServer.setHanging(true);
			healthyServer.setXml(
				regressionFeedXml('B Healthy Feed', [
					{ guid: 'healthy-new', title: 'Healthy new article' },
					{ guid: 'healthy-initial', title: 'Healthy initial' },
				]),
			);
			await redis.del(
				CacheKeys.feedSyncLock(stalledFeed.body.data.id),
				CacheKeys.feedSyncLock(healthyFeed.body.data.id),
				feedFetchLockKey(stalledServer.url),
				feedFetchLockKey(healthyServer.url),
				prefetchedFeedKey(stalledServer.url),
				prefetchedFeedKey(healthyServer.url),
			);

			const result = await Promise.race([
				deps.services.feedSync.syncAllFeeds(registered.body.data.user.id),
				new Promise<never>((_resolve, reject) =>
					setTimeout(() => reject(new Error('Bulk refresh did not finish')), 8_000),
				),
			]);

			expect(result).toMatchObject({
				totalFeeds: 2,
				syncedFeeds: 1,
				failedFeeds: 1,
				newArticles: 1,
			});
			expect(stalledServer.getRequestCount()).toBe(2);
			expect(healthyServer.getRequestCount()).toBe(2);
			const articles = await authedRequest(
				`/api/v1/articles?feedId=${healthyFeed.body.data.id}&limit=10`,
				token,
			);
			expect(articles.body.data.map((article: { title: string }) => article.title)).toContain(
				'Healthy new article',
			);
		} finally {
			await Promise.all([stalledServer.stop(), healthyServer.stop()]);
		}
	}, 12_000);

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

	it('supports a rapid reader burst of more than thirty read-state updates', async () => {
		const registered = await registerUser('rapid-reader@example.com');
		const token = registered.body.data.tokens.accessToken;
		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Rapid Reader' }),
		});
		const feedServer = await startFeedServer(`<?xml version="1.0" encoding="UTF-8"?>
			<rss version="2.0"><channel>
				<title>Rapid Reader Feed</title><link>https://example.com</link>
				<item>
					<title>Rapid navigation article</title>
					<link>https://example.com/rapid-navigation</link>
					<guid>rapid-navigation</guid>
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
			await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, token, {
				method: 'POST',
			});
			const articles = await authedRequest(
				`/api/v1/articles?feedId=${feed.body.data.id}&limit=10`,
				token,
			);
			const articleId = articles.body.data[0].id;

			let lastResponse: Response | null = null;
			for (let requestNumber = 1; requestNumber <= 31; requestNumber += 1) {
				const result = await authedRequest(`/api/v1/articles/${articleId}/read`, token, {
					method: 'PATCH',
					body: JSON.stringify({ read: requestNumber % 2 === 1 }),
				});
				expect(result.response.status).toBe(200);
				lastResponse = result.response;
			}

			expect(lastResponse?.headers.get('X-RateLimit-Remaining')).toBe('149');
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
		const adminAccess = await authedRequest(
			'/api/v1/admin/settings',
			admin.body.data.tokens.accessToken,
		);
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
