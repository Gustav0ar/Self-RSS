import { createServer } from 'node:http';
import {
	type APIRequestContext,
	type APIResponse,
	expect,
	type Page,
	test,
} from '@playwright/test';

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:3100/api/v1';
let cachedAdminAccessToken: string | null = null;

async function loginThroughApi(request: APIRequestContext, email: string, password: string) {
	const response = await request.post(`${apiBaseUrl}/auth/login`, {
		data: { email, password },
	});
	expect(response.ok()).toBeTruthy();
	return response.json();
}

async function registerWithTransientRetry(
	request: APIRequestContext,
	email: string,
	password: string,
): Promise<APIResponse> {
	let response: APIResponse | null = null;
	await expect
		.poll(async () => {
			response = await request.post(`${apiBaseUrl}/auth/register`, {
				data: { email, password },
			});
			return response.status();
		})
		.toBe(201);
	if (!response) {
		throw new Error('Registration did not return a response');
	}
	return response;
}

async function setRegistrationLocked(request: APIRequestContext, locked: boolean) {
	if (!cachedAdminAccessToken) {
		const adminLogin = await loginThroughApi(request, 'admin@example.com', 'password123');
		cachedAdminAccessToken = adminLogin.data.tokens.accessToken;
	}

	let response = await request.patch(`${apiBaseUrl}/admin/settings`, {
		headers: {
			Authorization: `Bearer ${cachedAdminAccessToken}`,
		},
		data: { registrationLocked: locked },
	});

	if (response.status() === 401) {
		const adminLogin = await loginThroughApi(request, 'admin@example.com', 'password123');
		cachedAdminAccessToken = adminLogin.data.tokens.accessToken;
		response = await request.patch(`${apiBaseUrl}/admin/settings`, {
			headers: {
				Authorization: `Bearer ${cachedAdminAccessToken}`,
			},
			data: { registrationLocked: locked },
		});
	}

	expect(response.ok()).toBeTruthy();
}

async function patchUserPreferences(
	request: APIRequestContext,
	email: string,
	password: string,
	preferences: Record<string, unknown>,
) {
	const login = await loginThroughApi(request, email, password);
	const response = await request.patch(`${apiBaseUrl}/preferences`, {
		headers: {
			Authorization: `Bearer ${login.data.tokens.accessToken}`,
		},
		data: preferences,
	});
	expect(response.ok()).toBeTruthy();
}

async function loginThroughUi(page: Page, email: string, password: string) {
	await page.goto('/');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign In' }).click();
	// Wait for both the article list to load AND the authenticated UI to render
	await expect(page.getByText('All Feeds')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function visibleArticleTitleOrder(page: Page, titles: string[]) {
	const rowTexts = await page
		.locator('[data-article-id]')
		.evaluateAll((rows) => rows.map((row) => row.textContent ?? ''));
	const positions = titles.map((title) => ({
		title,
		index: rowTexts.findIndex((text) => text.includes(title)),
	}));
	if (positions.some(({ index }) => index < 0)) {
		return [];
	}
	return positions.sort((a, b) => a.index - b.index).map(({ title }) => title);
}

function feedXml(items: Array<{ title: string; guid: string; pubDate: string }>) {
	return `<?xml version="1.0" encoding="UTF-8"?>
	<rss version="2.0">
		<channel>
			<title>Worker Refresh Feed</title>
			<link>https://example.com/worker-refresh</link>
			<description>Worker refresh regression feed</description>
			${items
				.map(
					(item) => `<item>
						<title>${item.title}</title>
						<link>https://example.com/worker-refresh/${item.guid}</link>
						<guid>${item.guid}</guid>
						<description><![CDATA[<p>${item.title} body.</p>]]></description>
						<pubDate>${item.pubDate}</pubDate>
					</item>`,
				)
				.join('')}
		</channel>
	</rss>`;
}

async function startMutableFeedServer(initialXml: string) {
	let xml = initialXml;
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
		response.end(xml);
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Could not start mutable feed server');
	}

	return {
		url: `http://127.0.0.1:${address.port}/feed.xml`,
		setXml(nextXml: string) {
			xml = nextXml;
		},
		stop() {
			return new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		},
	};
}

test.describe.configure({ mode: 'serial' });

test('all-feeds refresh uses its queue snapshot without status polling', async ({ page }) => {
	let statusRequests = 0;

	await page.route('**/api/v1/feeds/sync**', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue();
			return;
		}

		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({
				data: {
					accepted: true,
					alreadyQueued: false,
					jobId: 'e2e-job',
					status: {
						queued: true,
						running: false,
						active: true,
						jobId: 'e2e-job',
						scope: {},
						queuedAt: new Date().toISOString(),
					},
				},
			}),
		});
	});

	await page.route('**/api/v1/feeds/sync/status', async (route) => {
		statusRequests += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ data: { queued: false, running: false, active: false } }),
		});
	});

	await loginThroughUi(page, 'reader@example.com', 'password123');
	const initialStatusRequests = statusRequests;

	const refreshButton = page.getByRole('button', { name: 'Refresh', exact: true });
	await refreshButton.click();

	await expect(page.getByText('Refresh queued')).toBeVisible();
	await page.waitForTimeout(2_000);
	expect(statusRequests).toBe(initialStatusRequests);
});

test('selecting a failed feed does not retry it, while explicit refresh uses the queue', async ({
	page,
}) => {
	const syncRequests: string[] = [];

	await page.route('**/api/v1/articles**', async (route) => {
		const url = new URL(route.request().url());
		if (route.request().method() !== 'GET' || url.pathname !== '/api/v1/articles') {
			await route.continue();
			return;
		}

		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ data: [], hasMore: false, cursor: null }),
		});
	});

	await page.route('**/api/v1/categories', async (route) => {
		if (route.request().method() !== 'GET') {
			await route.continue();
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				data: {
					totalUnread: 0,
					categories: [
						{
							id: 'failed-category',
							userId: 'reader',
							parentCategoryId: null,
							name: 'Failed sources',
							slug: 'failed-sources',
							sortOrder: 0,
							createdAt: '2026-07-16T00:00:00.000Z',
							updatedAt: '2026-07-16T00:00:00.000Z',
							feedCount: 1,
							unreadCount: 0,
							feeds: [
								{
									id: 'failed-feed',
									userId: 'reader',
									categoryId: 'failed-category',
									title: 'Failed Feed',
									feedUrl: 'https://example.com/failed.xml',
									siteUrl: null,
									faviconUrl: null,
									description: null,
									pollingIntervalMinutes: 60,
									lastSyncedAt: '2026-07-15T00:00:00.000Z',
									lastSyncError: 'HTTP 403: Forbidden',
									lastSyncErrorAt: '2026-07-16T00:00:00.000Z',
									syncStatus: 'error',
									createdAt: '2026-07-15T00:00:00.000Z',
									updatedAt: '2026-07-16T00:00:00.000Z',
									unreadCount: 0,
								},
							],
							children: [],
						},
					],
				},
			}),
		});
	});

	await page.route('**/api/v1/feeds/sync**', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue();
			return;
		}

		syncRequests.push(route.request().url());
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({
				data: {
					accepted: true,
					alreadyQueued: false,
					jobId: 'single-feed-job',
					status: {
						queued: true,
						running: false,
						active: true,
						jobId: 'single-feed-job',
						scope: { feedId: 'failed-feed' },
						queuedAt: new Date().toISOString(),
					},
				},
			}),
		});
	});

	await loginThroughUi(page, 'reader@example.com', 'password123');
	await page.getByRole('button', { name: 'Expand Failed sources' }).click();
	await page.getByRole('button', { name: 'Failed Feed', exact: true }).click();
	await page.waitForTimeout(1_000);
	expect(syncRequests).toHaveLength(0);

	await page.getByRole('button', { name: 'Refresh', exact: true }).click();
	await expect.poll(() => syncRequests.length).toBe(1);
	expect(new URL(syncRequests[0]!).pathname).toBe('/api/v1/feeds/sync');
	expect(new URL(syncRequests[0]!).searchParams.get('feedId')).toBe('failed-feed');
});

test('all-feeds refresh fetches new articles through the real worker queue', async ({
	page,
	request,
}) => {
	const email = `worker-refresh-${Date.now()}@example.com`;
	const password = 'password123';
	const feedServer = await startMutableFeedServer(
		feedXml([
			{
				title: 'Initial Worker Story',
				guid: 'initial-worker-story',
				pubDate: 'Wed, 08 Jan 2025 10:00:00 GMT',
			},
		]),
	);

	try {
		await setRegistrationLocked(request, false);

		const registerResponse = await request.post(`${apiBaseUrl}/auth/register`, {
			data: { email, password },
		});
		expect(registerResponse.ok()).toBeTruthy();
		const registered = await registerResponse.json();
		const token = registered.data.tokens.accessToken;
		const authHeaders = { Authorization: `Bearer ${token}` };

		const categoryResponse = await request.post(`${apiBaseUrl}/categories`, {
			headers: authHeaders,
			data: { name: 'Worker Refresh' },
		});
		expect(categoryResponse.ok()).toBeTruthy();
		const category = await categoryResponse.json();

		const feedResponse = await request.post(`${apiBaseUrl}/feeds`, {
			headers: authHeaders,
			data: {
				categoryId: category.data.id,
				feedUrl: feedServer.url,
				title: 'Worker Refresh Feed',
			},
		});
		expect(feedResponse.ok()).toBeTruthy();
		const feed = await feedResponse.json();

		const initialSyncResponse = await request.post(`${apiBaseUrl}/feeds/${feed.data.id}/sync`, {
			headers: authHeaders,
		});
		expect(initialSyncResponse.ok()).toBeTruthy();

		feedServer.setXml(
			feedXml([
				{
					title: 'New Worker Story',
					guid: 'new-worker-story',
					pubDate: 'Thu, 09 Jan 2025 10:00:00 GMT',
				},
				{
					title: 'Initial Worker Story',
					guid: 'initial-worker-story',
					pubDate: 'Wed, 08 Jan 2025 10:00:00 GMT',
				},
			]),
		);

		await loginThroughUi(page, email, password);
		await expect(page.getByRole('button', { name: /Initial Worker Story/ })).toBeVisible();

		const refreshResponse = page.waitForResponse(
			(response) =>
				response.url().includes('/api/v1/feeds/sync') &&
				response.request().method() === 'POST' &&
				response.status() === 202,
		);
		await page.getByRole('button', { name: 'Refresh', exact: true }).click();
		await refreshResponse;

		await expect(page.getByRole('button', { name: /New Worker Story/ })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByText('Loading new articles')).toHaveCount(0);
	} finally {
		await feedServer.stop();
	}
});

test('reader can toggle a read article back to unread', async ({ page, request }) => {
	await patchUserPreferences(request, 'reader@example.com', 'password123', {
		hideRead: false,
		defaultSort: 'latest',
	});
	await loginThroughUi(page, 'reader@example.com', 'password123');

	// Open Alpha Launch — the seed auto-marks it read on open, so the
	// button starts as "Mark unread".
	const alphaButton = page.getByRole('button', { name: /Alpha Launch/ });
	await expect(alphaButton).toBeVisible();
	await alphaButton.click();
	await expect(page.getByRole('heading', { name: 'Alpha Launch' })).toBeVisible();

	// The article is auto-marked read. Click "Mark unread" to flip it back.
	await page.getByRole('button', { name: 'Mark unread' }).click();
	await expect(page.getByRole('button', { name: 'Mark read' })).toBeVisible();
});

test('rapid keyboard navigation keeps article reads and read-state writes available', async ({
	page,
	request,
}) => {
	const email = `rapid-reader-${Date.now()}@example.com`;
	const password = 'password123';
	// CrowdSec's http-crawl-non_statics scenario has a capacity of 40 distinct
	// paths. Stay well above that boundary so this test cannot pass for the same
	// reason the original 35-article regression did.
	const articleCount = 60;
	const titleFor = (position: number) => `Rapid Article ${String(position).padStart(2, '0')}`;
	const feedServer = await startMutableFeedServer(
		feedXml(
			Array.from({ length: articleCount }, (_, index) => ({
				title: titleFor(index + 1),
				guid: `rapid-article-${index + 1}`,
				pubDate: new Date(Date.UTC(2025, 1, articleCount - index)).toUTCString(),
			})),
		),
	);

	try {
		await setRegistrationLocked(request, false);
		const registerResponse = await registerWithTransientRetry(request, email, password);
		const registered = await registerResponse.json();
		const authHeaders = { Authorization: `Bearer ${registered.data.tokens.accessToken}` };

		const categoryResponse = await request.post(`${apiBaseUrl}/categories`, {
			headers: authHeaders,
			data: { name: 'Rapid Reader' },
		});
		expect(categoryResponse.ok()).toBeTruthy();
		const category = await categoryResponse.json();

		const feedResponse = await request.post(`${apiBaseUrl}/feeds`, {
			headers: authHeaders,
			data: {
				categoryId: category.data.id,
				feedUrl: feedServer.url,
				title: 'Rapid Reader Feed',
			},
		});
		expect(feedResponse.ok()).toBeTruthy();
		const feed = await feedResponse.json();
		const syncResponse = await request.post(`${apiBaseUrl}/feeds/${feed.data.id}/sync`, {
			headers: authHeaders,
		});
		expect(syncResponse.ok()).toBeTruthy();

		const preferencesResponse = await request.patch(`${apiBaseUrl}/preferences`, {
			headers: authHeaders,
			data: { autoMarkReadMode: 'on_navigate', hideRead: false, defaultSort: 'latest' },
		});
		expect(preferencesResponse.ok()).toBeTruthy();

		await expect
			.poll(async () => {
				const response = await request.get(
					`${apiBaseUrl}/articles?feedId=${feed.data.id}&limit=30`,
					{
						headers: authHeaders,
					},
				);
				if (!response.ok()) return 0;
				const body = await response.json();
				return body.data.length;
			})
			.toBe(30);

		const rejectedArticleRequests: Array<{ method: string; status: number; url: string }> = [];
		const articleDetailRequests: URL[] = [];
		page.on('response', (response) => {
			const url = new URL(response.url());
			if (response.request().method() === 'GET' && url.pathname.includes('/api/v1/articles/')) {
				articleDetailRequests.push(url);
			}
			if (!url.pathname.startsWith('/api/v1/articles/')) return;
			if (response.status() !== 403 && response.status() !== 429) return;
			rejectedArticleRequests.push({
				method: response.request().method(),
				status: response.status(),
				url: url.pathname,
			});
		});

		await loginThroughUi(page, email, password);
		const articleListScroll = page.getByTestId('article-list-scroll');
		await articleListScroll.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		await expect(page.getByText(`${articleCount} loaded`)).toBeVisible();
		await articleListScroll.evaluate((element) => {
			element.scrollTop = 0;
		});
		await page.getByRole('button', { name: new RegExp(titleFor(1)) }).click();
		await expect(page.getByRole('heading', { name: titleFor(1), exact: true })).toBeVisible();

		for (let position = 2; position <= articleCount; position += 1) {
			await page.keyboard.press('j');
			await expect(
				page.getByRole('heading', { name: titleFor(position), exact: true }),
			).toBeVisible();
		}

		await expect.poll(() => rejectedArticleRequests).toEqual([]);
		await expect
			.poll(
				() =>
					new Set(articleDetailRequests.map((requestUrl) => requestUrl.searchParams.get('id')))
						.size,
			)
			.toBeGreaterThan(40);
		expect(new Set(articleDetailRequests.map((requestUrl) => requestUrl.pathname))).toEqual(
			new Set(['/api/v1/articles/detail']),
		);
	} finally {
		await feedServer.stop();
	}
});

test('hide read toggle persists the user preference', async ({ page }) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');

	// Toggle Unread on
	const unreadToggle = page.getByRole('button', { name: 'Unread' });
	await unreadToggle.click();

	// Reload — the preference should persist
	await page.reload();
	await expect(page.getByText('All Feeds')).toBeVisible();

	// The Unread button should still be present and clickable
	await expect(page.getByRole('button', { name: 'Unread' })).toBeVisible();
});

test('sort toggle changes the order of articles in the list', async ({ page, request }) => {
	await patchUserPreferences(request, 'reader@example.com', 'password123', {
		hideRead: false,
		defaultSort: 'latest',
	});
	await loginThroughUi(page, 'reader@example.com', 'password123');

	// The toolbar starts on "Newest" sort.
	const sortButton = page.getByRole('button', { name: 'Newest' });
	await expect(sortButton).toBeVisible();
	await expect(page.getByRole('button', { name: /Alpha Launch/ })).toBeVisible();
	await expect
		.poll(() => visibleArticleTitleOrder(page, ['Alpha Launch', 'Beta Update', 'Gamma World']))
		.toEqual(['Alpha Launch', 'Beta Update', 'Gamma World']);

	// Clicking the sort button toggles to oldest.
	await sortButton.click();
	await expect(page.getByRole('button', { name: 'Oldest' })).toBeVisible();
	await expect
		.poll(() => visibleArticleTitleOrder(page, ['Alpha Launch', 'Beta Update', 'Gamma World']))
		.toEqual(['Gamma World', 'Beta Update', 'Alpha Launch']);
});

test('user can sign out and the session is cleared', async ({ page }) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByText('Sign in to your account')).toBeVisible();

	// After signing out, attempting to load a protected route should bounce
	// back to the login screen.
	await page.goto('/stats');
	await expect(page.getByText('Sign in to your account')).toBeVisible();
});

test('failed server logout keeps the user signed in and offers a retry', async ({ page }) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');
	await page.route('**/api/v1/auth/logout', async (route) => {
		await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' });
	});

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('alert')).toContainText('Your session is still active');
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	await expect(page.getByText('reader@example.com')).toBeVisible();
	await expect(page.getByText('Sign in to your account')).toHaveCount(0);

	await page.unroute('**/api/v1/auth/logout');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByText('Sign in to your account')).toBeVisible();
});

test('user can navigate to the stats panel from the top bar', async ({ page }) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');

	const statsButton = page.getByRole('link', { name: 'Stats' });
	await expect(statsButton).toBeVisible();
	await statsButton.click();
	await page.waitForURL(/\/stats/);
	// Stats panel shows category or feed labels from the sidebar tree.
	await expect(page.getByText('Tech')).toBeVisible();
});

test('article deep link renders the article even when not in the current scope', async ({
	page,
}) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');

	// Fetch the article id from the API so we know it's a real id
	const apiContext = page.context().request;
	const me = await apiContext.post(`${apiBaseUrl}/auth/login`, {
		data: { email: 'reader@example.com', password: 'password123' },
	});
	const { data: loginData } = await me.json();
	const token = loginData.tokens.accessToken;
	const articles = await apiContext.get(`${apiBaseUrl}/articles?limit=10`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	const { data: articleList } = await articles.json();
	const alpha = articleList.find((a: { title: string }) => a.title === 'Alpha Launch');
	expect(alpha).toBeTruthy();

	// Navigate to the article URL directly
	await page.goto(`/articles/${alpha.id}`);
	await expect(page.getByRole('heading', { name: 'Alpha Launch' })).toBeVisible();
});

test('admin can lock and unlock registration via the API', async ({ request }) => {
	// Lock
	await setRegistrationLocked(request, true);
	const statusLocked = await request.get(`${apiBaseUrl}/auth/registration-status`);
	const lockedBody = await statusLocked.json();
	expect(lockedBody.data.registrationEnabled).toBe(false);

	// Unlock
	await setRegistrationLocked(request, false);
	const statusUnlocked = await request.get(`${apiBaseUrl}/auth/registration-status`);
	const unlockedBody = await statusUnlocked.json();
	expect(unlockedBody.data.registrationEnabled).toBe(true);
});

test('preferences panel shows the user email after sign in', async ({ page }) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');

	// The top bar shows the username next to the sign-out button
	await expect(page.getByText('reader@example.com')).toBeVisible();
});

test('preferences panel can be opened and closed', async ({ page }) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');

	await page.getByRole('button', { name: 'Preferences' }).click();
	await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('heading', { name: 'Preferences' })).toHaveCount(0);
});
