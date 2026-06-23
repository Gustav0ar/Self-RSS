import { createServer } from 'node:http';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDeps } from '../../src/config/deps.js';
import { clearEnvCache } from '../../src/config/env.js';
import { closeDb, getDb } from '../../src/db/client.js';
import { CacheKeys, closeRedis, getRedis } from '../../src/db/redis.js';
import { auditLogs, authSessions, users } from '../../src/db/schema.js';
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
		'auth_sessions',
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

function createSseReader(response: Response) {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('Expected streaming response body');
	}
	const decoder = new TextDecoder();
	let buffer = '';

	function parse(rawEvent: string) {
		let event = 'message';
		const data: string[] = [];
		for (const rawLine of rawEvent.split('\n')) {
			const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
			if (line.startsWith(':')) {
				continue;
			}
			const separator = line.indexOf(':');
			const field = separator === -1 ? line : line.slice(0, separator);
			const rawValue = separator === -1 ? '' : line.slice(separator + 1);
			const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
			if (field === 'event') {
				event = value;
			} else if (field === 'data') {
				data.push(value);
			}
		}
		return { event, data: data.length ? JSON.parse(data.join('\n')) : null };
	}

	return {
		async next(timeoutMs = 2000) {
			let timeoutId: ReturnType<typeof setTimeout> | null = null;
			const timeout = new Promise<never>((_, reject) => {
				timeoutId = setTimeout(
					() => reject(new Error('Timed out waiting for SSE event')),
					timeoutMs,
				);
			});

			try {
				return await Promise.race([
					(async () => {
						while (true) {
							const eventBoundary = buffer.indexOf('\n\n');
							if (eventBoundary >= 0) {
								const rawEvent = buffer.slice(0, eventBoundary);
								buffer = buffer.slice(eventBoundary + 2);
								if (rawEvent.trim()) {
									return parse(rawEvent);
								}
							}

							const { done, value } = await reader.read();
							if (done) {
								throw new Error('SSE stream closed before the next event');
							}
							buffer += decoder.decode(value, { stream: true });
						}
					})(),
					timeout,
				]);
			} finally {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
			}
		},
		async cancel() {
			await reader.cancel();
		},
	};
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

describe('API integration', () => {
	it('blocks public registration when ALLOW_REGISTRATION is false, even for bootstrap admin', async () => {
		const previousAllowRegistration = process.env.ALLOW_REGISTRATION;
		process.env.ALLOW_REGISTRATION = 'false';
		clearEnvCache();

		try {
			const status = await jsonRequest('/api/v1/auth/registration-status');
			expect(status.response.status).toBe(200);
			expect(status.body.data.registrationEnabled).toBe(false);

			const blocked = await registerUser('bootstrap-blocked@example.com');
			expect(blocked.response.status).toBe(403);
			expect(blocked.body.error.message).toContain('Registration is disabled');

			const userCountRows = await db.select({ count: sql<number>`count(*)` }).from(users);
			expect(userCountRows[0]?.count).toBe(0);
		} finally {
			if (previousAllowRegistration === undefined) {
				delete process.env.ALLOW_REGISTRATION;
			} else {
				process.env.ALLOW_REGISTRATION = previousAllowRegistration;
			}
			clearEnvCache();
		}
	});

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

		const adminToken = refreshed.body.data.tokens.accessToken;

		const sessions = await authedRequest('/api/v1/auth/sessions', adminToken);
		expect(sessions.response.status).toBe(200);
		expect(sessions.body.data.sessions).toHaveLength(1);
		expect(sessions.body.data.sessions[0].current).toBe(true);

		const [storedSession] = await db.select().from(authSessions);
		expect(storedSession).toBeTruthy();
		const unchangedHash = storedSession!.refreshTokenHash;
		const staleRotate = await deps.repos.authSession.rotate(
			storedSession!.id,
			'stale-refresh-token-hash',
			'next-refresh-token-hash',
			{ deviceName: 'Stale rotation' },
		);
		expect(staleRotate).toBeUndefined();
		const [unchangedSession] = await db.select().from(authSessions);
		expect(unchangedSession!.refreshTokenHash).toBe(unchangedHash);
		expect(unchangedSession!.deviceName).not.toBe('Stale rotation');

		const androidLogin = await jsonRequest('/api/v1/auth/login', {
			method: 'POST',
			headers: {
				...JSON_HEADERS,
				'X-Self-Feed-Client-Id': 'android-client',
				'X-Self-Feed-Device-Name': 'Android app on Pixel 8',
				'X-Forwarded-For': '203.0.113.10',
			},
			body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
		});
		expect(androidLogin.response.status).toBe(200);

		const sessionsWithAndroid = await authedRequest('/api/v1/auth/sessions', adminToken);
		expect(sessionsWithAndroid.response.status).toBe(200);
		expect(sessionsWithAndroid.body.data.sessions).toHaveLength(2);
		const androidSession = sessionsWithAndroid.body.data.sessions.find(
			(session: { deviceName: string }) => session.deviceName === 'Android app on Pixel 8',
		);
		if (!androidSession) {
			throw new Error('Expected Android session to be listed');
		}

		const revokedAndroid = await authedRequest(
			`/api/v1/auth/sessions/${androidSession.id}`,
			adminToken,
			{ method: 'DELETE' },
		);
		expect(revokedAndroid.response.status).toBe(200);

		const revokedAndroidMe = await authedRequest(
			'/api/v1/auth/me',
			androidLogin.body.data.tokens.accessToken,
		);
		expect(revokedAndroidMe.response.status).toBe(401);

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

		const loggedOutAccess = await authedRequest('/api/v1/auth/me', adminToken);
		expect(loggedOutAccess.response.status).toBe(401);
	});

	it('only records session IPs from proxy headers when proxy trust is enabled', async () => {
		const previousTrustProxy = process.env.TRUST_PROXY;
		process.env.TRUST_PROXY = 'false';
		clearEnvCache();

		try {
			const registered = await jsonRequest('/api/v1/auth/register', {
				method: 'POST',
				headers: {
					...JSON_HEADERS,
					'X-Forwarded-For': '198.51.100.1',
					'X-Self-Feed-Device-Name': 'Untrusted browser',
				},
				body: JSON.stringify({ email: 'proxy-user@example.com', password: 'password123' }),
			});
			expect(registered.response.status).toBe(201);

			const untrustedSessions = await authedRequest(
				'/api/v1/auth/sessions',
				registered.body.data.tokens.accessToken,
			);
			expect(untrustedSessions.response.status).toBe(200);
			expect(untrustedSessions.body.data.sessions[0].ipAddress).toBeNull();

			process.env.TRUST_PROXY = 'true';
			clearEnvCache();

			const trustedLogin = await jsonRequest('/api/v1/auth/login', {
				method: 'POST',
				headers: {
					...JSON_HEADERS,
					'X-Forwarded-For': '203.0.113.25',
					'X-Self-Feed-Device-Name': 'Trusted browser',
				},
				body: JSON.stringify({ email: 'proxy-user@example.com', password: 'password123' }),
			});
			expect(trustedLogin.response.status).toBe(200);

			const trustedSessions = await authedRequest(
				'/api/v1/auth/sessions',
				trustedLogin.body.data.tokens.accessToken,
			);
			const trustedSession = trustedSessions.body.data.sessions.find(
				(session: { deviceName: string }) => session.deviceName === 'Trusted browser',
			);
			expect(trustedSession?.ipAddress).toBe('203.0.113.25');

			const fallbackLogin = await jsonRequest('/api/v1/auth/login', {
				method: 'POST',
				headers: {
					...JSON_HEADERS,
					'X-Forwarded-For': 'not an ip',
					'X-Real-Ip': 'also not an ip',
					'CF-Connecting-IP': '198.51.100.77',
					'X-Self-Feed-Device-Name': 'Fallback proxy browser',
				},
				body: JSON.stringify({ email: 'proxy-user@example.com', password: 'password123' }),
			});
			expect(fallbackLogin.response.status).toBe(200);

			const fallbackSessions = await authedRequest(
				'/api/v1/auth/sessions',
				fallbackLogin.body.data.tokens.accessToken,
			);
			const fallbackSession = fallbackSessions.body.data.sessions.find(
				(session: { deviceName: string }) => session.deviceName === 'Fallback proxy browser',
			);
			expect(fallbackSession?.ipAddress).toBe('198.51.100.77');
		} finally {
			if (previousTrustProxy === undefined) {
				delete process.env.TRUST_PROXY;
			} else {
				process.env.TRUST_PROXY = previousTrustProxy;
			}
			clearEnvCache();
		}
	});

	it('bounds stored session metadata from request headers', async () => {
		const longDeviceName = 'D'.repeat(180);
		const longClientId = 'C'.repeat(220);
		const longUserAgent = 'U'.repeat(700);
		const registered = await jsonRequest('/api/v1/auth/register', {
			method: 'POST',
			headers: {
				...JSON_HEADERS,
				'User-Agent': longUserAgent,
				'X-Self-Feed-Client-Id': ` ${longClientId} `,
				'X-Self-Feed-Device-Name': ` ${longDeviceName} `,
			},
			body: JSON.stringify({ email: 'metadata-user@example.com', password: 'password123' }),
		});
		expect(registered.response.status).toBe(201);

		const sessions = await authedRequest(
			'/api/v1/auth/sessions',
			registered.body.data.tokens.accessToken,
		);
		expect(sessions.response.status).toBe(200);
		const [session] = sessions.body.data.sessions;
		expect(session.deviceName).toBe('D'.repeat(120));
		expect(session.clientId).toBe('C'.repeat(160));
		expect(session.userAgent).toBe('U'.repeat(512));
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

			const grandchildCategory = await authedRequest('/api/v1/categories', token1, {
				method: 'POST',
				body: JSON.stringify({ name: 'Runtime', parentCategoryId: childCategory.body.data.id }),
			});
			expect(grandchildCategory.response.status).toBe(201);

			const cycleUpdate = await authedRequest(
				`/api/v1/categories/${parentCategory.body.data.id}`,
				token1,
				{
					method: 'PATCH',
					body: JSON.stringify({ parentCategoryId: grandchildCategory.body.data.id }),
				},
			);
			expect(cycleUpdate.response.status).toBe(400);
			expect(cycleUpdate.body.error.message).toContain('descendants');

			const parentDeleteWithChild = await authedRequest(
				`/api/v1/categories/${parentCategory.body.data.id}`,
				token1,
				{ method: 'DELETE' },
			);
			expect(parentDeleteWithChild.response.status).toBe(400);
			expect(parentDeleteWithChild.body.error.message).toContain('subcategories');

			const leafDelete = await authedRequest(
				`/api/v1/categories/${grandchildCategory.body.data.id}`,
				token1,
				{ method: 'DELETE' },
			);
			expect(leafDelete.response.status).toBe(200);

			const createFeed = await authedRequest('/api/v1/feeds', token1, {
				method: 'POST',
				body: JSON.stringify({
					categoryId: childCategory.body.data.id,
					feedUrl: feedServer.url,
				}),
			});
			expect(createFeed.response.status).toBe(201);
			expect(createFeed.body.data.title).toBe('Example Feed');

			const parentScopedFeeds = await authedRequest(
				`/api/v1/feeds?categoryId=${parentCategory.body.data.id}`,
				token1,
			);
			expect(parentScopedFeeds.response.status).toBe(200);
			expect(parentScopedFeeds.body.data.map((feed: { id: string }) => feed.id)).toContain(
				createFeed.body.data.id,
			);

			const categoryTree = await authedRequest('/api/v1/categories', token1);
			expect(categoryTree.body.data.categories[0]).toMatchObject({
				id: parentCategory.body.data.id,
				feedCount: 1,
				children: [
					expect.objectContaining({
						id: childCategory.body.data.id,
						feedCount: 1,
					}),
				],
			});

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
			const categoryNames = categories.body.data.categories.flatMap(function collect(category: {
				name: string;
				children?: unknown[];
			}): string[] {
				return [
					category.name,
					...(category.children ?? []).flatMap((child) =>
						collect(child as { name: string; children?: unknown[] }),
					),
				];
			});
			expect(categoryNames).toEqual(expect.arrayContaining(['Engineering', 'Frontend']));

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
		let events: ReturnType<typeof createSseReader> | null = null;
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

			const eventResponse = await app.request('/api/v1/events/read-state', {
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Self-Feed-Client-Id': 'listener-client',
				},
			});
			expect(eventResponse.status).toBe(200);
			expect(eventResponse.headers.get('Content-Type')).toContain('text/event-stream');
			events = createSseReader(eventResponse);
			const connectedEvent = await events.next();
			expect(connectedEvent.event).toBe('read-state.connected');

			const markRead = await authedRequest(`/api/v1/articles/${articleId}/read`, token, {
				method: 'PATCH',
				headers: {
					'X-Self-Feed-Client-Id': 'writer-client',
				},
				body: JSON.stringify({ read: true }),
			});
			expect(markRead.response.status).toBe(200);
			const markReadEvent = await events.next();
			expect(markReadEvent.event).toBe('read-state');
			expect(markReadEvent.data).toMatchObject({
				type: 'article.read_state_changed',
				articleId,
				feedId: feed.body.data.id,
				isRead: true,
				source: 'manual',
				clientId: 'writer-client',
			});

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
				headers: {
					'X-Self-Feed-Client-Id': 'writer-client',
				},
				body: JSON.stringify({ categoryId: category.body.data.id }),
			});
			expect(markAll.response.status).toBe(200);
			expect(markAll.body.data.markedCount).toBe(1);
			const markAllEvent = await events.next();
			expect(markAllEvent.event).toBe('read-state');
			expect(markAllEvent.data).toMatchObject({
				type: 'articles.marked_read',
				feedIds: [feed.body.data.id],
				scope: { categoryId: category.body.data.id },
				markedCount: 1,
				clientId: 'writer-client',
			});
			await events.cancel();
			events = null;

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
			expect(updatedPreferences.body.data.autoMarkReadMode).toBe('on_navigate');

			const preferences = await authedRequest('/api/v1/preferences', token);
			expect(preferences.body.data.hideRead).toBe(true);

			const stats = await authedRequest('/api/v1/stats', token);
			expect(stats.response.status).toBe(200);
			expect(stats.body.data.totalFeeds).toBe(1);
			expect(stats.body.data.totalCategories).toBe(1);
			expect(stats.body.data.totalRead).toBe(2);
			expect(stats.body.data.dailyMetrics[0].searchCount).toBeGreaterThanOrEqual(1);
		} finally {
			await events?.cancel().catch(() => undefined);
			await feedServer.stop();
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

	it('paginates warm cached article lists with a stable cursor', async () => {
		const registered = await registerUser('cached-pagination@example.com');
		const token = registered.body.data.tokens.accessToken;
		const userId = registered.body.data.user.id;

		const category = await authedRequest('/api/v1/categories', token, {
			method: 'POST',
			body: JSON.stringify({ name: 'Cached Pagination' }),
		});

		const items = Array.from({ length: 35 }, (_, index) => {
			const storyNumber = 35 - index;
			const publishedAt = new Date(Date.UTC(2026, 1, storyNumber, 12, 0, 0)).toUTCString();
			return `<item>
				<title>Cached Cursor Story ${storyNumber}</title>
				<link>https://example.com/cached-cursor/${storyNumber}</link>
				<guid>cached-cursor-story-${storyNumber}</guid>
				<description><![CDATA[<p>Cached cursor story ${storyNumber} body.</p>]]></description>
				<pubDate>${publishedAt}</pubDate>
			</item>`;
		}).join('');

		const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
		<rss version="2.0">
			<channel>
				<title>Cached Cursor Feed</title>
				<link>https://example.com/cached-cursor</link>
				<description>Cached cursor pagination feed</description>
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
					title: 'Cached Cursor Feed',
				}),
			});
			expect(feed.response.status).toBe(201);

			const sync = await authedRequest(`/api/v1/feeds/${feed.body.data.id}/sync`, token, {
				method: 'POST',
			});
			expect(sync.response.status).toBe(200);
			expect(sync.body.data.newArticles).toBe(35);

			await deps.services.articleCache.populateCache(userId);

			const firstPage = await authedRequest('/api/v1/articles?sort=latest&limit=30', token);
			expect(firstPage.response.status).toBe(200);
			expect(firstPage.body.data).toHaveLength(30);
			expect(firstPage.body.hasMore).toBe(true);
			expect(firstPage.body.cursor.split(':')).toHaveLength(3);
			expect(firstPage.body.data[0].title).toBe('Cached Cursor Story 35');
			expect(firstPage.body.data.at(-1)?.title).toBe('Cached Cursor Story 6');

			const secondPage = await authedRequest(
				`/api/v1/articles?sort=latest&limit=30&cursor=${encodeURIComponent(firstPage.body.cursor)}`,
				token,
			);
			expect(secondPage.response.status).toBe(200);
			expect(secondPage.body.data).toHaveLength(5);
			expect(secondPage.body.hasMore).toBe(false);
			expect(secondPage.body.data[0].title).toBe('Cached Cursor Story 5');
			expect(secondPage.body.data.at(-1)?.title).toBe('Cached Cursor Story 1');

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

			const queuedStatus = await authedRequest('/api/v1/feeds/sync/status', token);
			expect(queuedStatus.response.status).toBe(200);
			expect(queuedStatus.body.data).toEqual({
				queued: true,
				running: false,
				active: true,
			});

			await redis.set(
				CacheKeys.feedSyncAllQueued(registered.body.data.user.id),
				String(Date.now() - 120_000),
				'EX',
				1800,
			);
			const staleMarkerStatus = await authedRequest('/api/v1/feeds/sync/status', token);
			expect(staleMarkerStatus.response.status).toBe(200);
			expect(staleMarkerStatus.body.data).toEqual({
				queued: true,
				running: false,
				active: true,
			});

			await redis.del(CacheKeys.feedSyncAllQueued(registered.body.data.user.id));
			const queuedWithoutMarkerStatus = await authedRequest('/api/v1/feeds/sync/status', token);
			expect(queuedWithoutMarkerStatus.response.status).toBe(200);
			expect(queuedWithoutMarkerStatus.body.data).toEqual({
				queued: true,
				running: false,
				active: true,
			});

			const duplicateSync = await authedRequest('/api/v1/feeds/sync', token, {
				method: 'POST',
			});
			expect(duplicateSync.response.status).toBe(202);
			expect(duplicateSync.body.data).toEqual({
				accepted: true,
				alreadyQueued: true,
			});
			await expect(redis.llen(CacheKeys.feedSyncAllQueue())).resolves.toBe(1);

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

			const completedStatus = await authedRequest('/api/v1/feeds/sync/status', token);
			expect(completedStatus.response.status).toBe(200);
			expect(completedStatus.body.data).toEqual({
				queued: false,
				running: false,
				active: false,
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
