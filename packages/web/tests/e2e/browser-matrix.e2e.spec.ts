import { expect, type Page, test } from '@playwright/test';
import type {
	ArticleDetail,
	ArticleListItem,
	CategoryWithCounts,
	FeedWithCounts,
} from '@self-feed/shared';

const techCategoryId = '11111111-1111-4111-8111-111111111111';
const bunFeedId = '22222222-2222-4222-8222-222222222222';
const alphaArticleId = '33333333-3333-4333-8333-333333333333';
const betaArticleId = '44444444-4444-4444-8444-444444444444';
const gammaArticleId = '55555555-5555-4555-8555-555555555555';
const timestamp = '2025-01-10T10:00:00.000Z';

const bunFeed: FeedWithCounts = {
	id: bunFeedId,
	userId: 'reader',
	categoryId: techCategoryId,
	title: 'Bun Blog',
	feedUrl: 'https://example.com/bun.xml',
	siteUrl: 'https://example.com/bun',
	faviconUrl: null,
	description: 'Bun updates',
	pollingIntervalMinutes: 60,
	lastSyncedAt: timestamp,
	lastSyncError: null,
	lastSyncErrorAt: null,
	syncStatus: 'idle',
	lifecycleStatus: 'active',
	createdAt: timestamp,
	updatedAt: timestamp,
	unreadCount: 2,
};

const categories: CategoryWithCounts[] = [
	{
		id: techCategoryId,
		userId: 'reader',
		parentCategoryId: null,
		name: 'Tech',
		slug: 'tech',
		sortOrder: 0,
		createdAt: timestamp,
		updatedAt: timestamp,
		feedCount: 1,
		unreadCount: 2,
		feeds: [bunFeed],
		children: [],
	},
];

const alphaArticle: ArticleListItem = {
	id: alphaArticleId,
	feedId: bunFeedId,
	feedTitle: 'Bun Blog',
	feedFaviconUrl: null,
	title: 'Alpha Launch',
	author: 'Bun Team',
	excerpt: 'Alpha launch ships fast JavaScript tooling.',
	heroImageUrl: null,
	publishedAt: timestamp,
	displayedAt: timestamp,
	isRead: false,
	contentStatus: 'full_ready',
	contentVersion: 1,
};

const betaArticle: ArticleListItem = {
	...alphaArticle,
	id: betaArticleId,
	title: 'Beta Update',
	excerpt: 'Beta update improves package installs.',
	publishedAt: '2025-01-09T10:00:00.000Z',
	displayedAt: '2025-01-09T10:00:00.000Z',
};

const gammaArticle: ArticleListItem = {
	...alphaArticle,
	id: gammaArticleId,
	feedId: '66666666-6666-4666-8666-666666666666',
	feedTitle: 'World News',
	title: 'Gamma World',
	author: 'Reporter',
	excerpt: 'Gamma world coverage and analysis.',
	publishedAt: '2025-01-08T10:00:00.000Z',
	displayedAt: '2025-01-08T10:00:00.000Z',
};

function articleDetail(article: ArticleListItem): ArticleDetail {
	return {
		...article,
		guid: article.id,
		canonicalUrl: `https://example.com/articles/${article.id}`,
		contentHtml: `<p>${article.excerpt}</p>`,
		contentText: article.excerpt,
		fetchedAt: timestamp,
		hash: article.id,
		enrichmentQueuedAt: null,
		enrichmentAttemptedAt: null,
		enrichedAt: timestamp,
		enrichmentError: null,
		feedSiteUrl: 'https://example.com',
		media: [],
		isEnriched: true,
	};
}

async function installStableReaderFixture(page: Page) {
	await page.route('**/api/v1/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const { pathname } = url;

		if (request.method() === 'GET' && pathname === '/api/v1/categories') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data: { categories, totalUnread: 2 } }),
			});
			return;
		}

		if (request.method() === 'GET' && pathname === '/api/v1/feeds') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data: [bunFeed] }),
			});
			return;
		}

		if (request.method() === 'GET' && pathname === '/api/v1/feeds/sync/status') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data: { queued: false, running: false, active: false } }),
			});
			return;
		}

		if (request.method() === 'POST' && pathname === '/api/v1/feeds/sync') {
			await route.fulfill({
				status: 202,
				contentType: 'application/json',
				body: JSON.stringify({
					data: {
						accepted: true,
						alreadyQueued: false,
						jobId: 'browser-matrix-job',
						status: {
							queued: true,
							running: false,
							active: true,
							jobId: 'browser-matrix-job',
							scope: { feedId: url.searchParams.get('feedId') ?? undefined },
							queuedAt: timestamp,
						},
					},
				}),
			});
			return;
		}

		if (request.method() === 'GET' && pathname === '/api/v1/articles') {
			const data = url.searchParams.has('feedId')
				? [alphaArticle, betaArticle]
				: [alphaArticle, betaArticle, gammaArticle];
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data, hasMore: false, cursor: null }),
			});
			return;
		}

		if (request.method() === 'GET' && pathname === '/api/v1/articles/detail') {
			const articleId = url.searchParams.get('id');
			const article =
				articleId === gammaArticleId
					? gammaArticle
					: articleId === betaArticleId
						? betaArticle
						: alphaArticle;
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data: articleDetail(article) }),
			});
			return;
		}

		if (request.method() === 'PATCH' && /^\/api\/v1\/articles\/[^/]+\/read$/.test(pathname)) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data: { success: true } }),
			});
			return;
		}

		if (request.method() === 'GET' && pathname === '/api/v1/search') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data: [gammaArticle], hasMore: false, cursor: null }),
			});
			return;
		}

		await route.continue();
	});
}

function unreadBadgeName(name: string) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`^${escaped}(?: \\d+)?$`);
}

async function loginThroughUi(page: Page) {
	await page.goto('/');
	await page.getByLabel('Email').fill('reader@example.com');
	await page.getByLabel('Password').fill('password123');
	await page.getByRole('button', { name: 'Sign In' }).click();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	await expect(page.getByText('Reading queue')).toBeVisible();
}

async function openSidebarWhenCollapsed(page: Page) {
	const openMenu = page.getByRole('button', { name: 'Open menu' });
	if (await openMenu.isVisible()) {
		await openMenu.click();
		await expect(page.getByRole('dialog', { name: 'Feeds' })).toBeVisible();
	}
}

async function selectBunFeed(page: Page) {
	await openSidebarWhenCollapsed(page);
	await page.getByRole('button', { name: unreadBadgeName('Tech') }).click();
	await expect(page.getByRole('heading', { name: 'Tech' })).toBeVisible();

	await openSidebarWhenCollapsed(page);
	await page.getByRole('button', { name: unreadBadgeName('Bun Blog') }).click();
	await expect(page.getByRole('heading', { name: 'Bun Blog' })).toBeVisible();
}

test.describe('bounded browser matrix', () => {
	test('login, navigation, reader back, search, and preferences remain usable', async ({
		page,
	}) => {
		await installStableReaderFixture(page);
		await loginThroughUi(page);
		await selectBunFeed(page);

		await page.getByRole('button', { name: /Alpha Launch/ }).click();
		await expect(page.getByRole('heading', { name: 'Alpha Launch' })).toBeVisible();

		const backToList = page.getByRole('button', { name: 'Back to article list' });
		if (await backToList.isVisible()) {
			await backToList.click();
		} else {
			await page.goBack();
		}
		await expect(page.getByRole('heading', { name: 'Bun Blog' })).toBeVisible();
		await expect(page.getByRole('button', { name: /Alpha Launch/ })).toBeVisible();

		await page.getByRole('combobox', { name: 'Search articles' }).fill('Gamma');
		const gammaResult = page.getByRole('option', { name: /Gamma World/ });
		await expect(gammaResult).toBeVisible();
		await gammaResult.click();
		await expect(page).toHaveURL(/\/articles\//);
		await expect(page.getByRole('heading', { name: 'Gamma World' })).toBeVisible();

		await page.getByRole('button', { name: 'Preferences' }).click();
		const preferences = page.getByRole('dialog', { name: 'Preferences' });
		await expect(preferences).toBeVisible();
		await expect(preferences.getByRole('combobox', { name: 'Theme' })).toBeVisible();
		await expect(preferences.getByRole('combobox', { name: 'Font Family' })).toBeVisible();
		await preferences.getByRole('button', { name: 'Close' }).click();
		await expect(preferences).toHaveCount(0);
	});

	test('mark-all confirmation remains scoped and cancel is non-destructive', async ({ page }) => {
		await installStableReaderFixture(page);
		await loginThroughUi(page);
		await selectBunFeed(page);

		let markAllRequests = 0;
		page.on('request', (request) => {
			if (new URL(request.url()).pathname === '/api/v1/articles/mark-all-read') {
				markAllRequests += 1;
			}
		});

		await page.getByRole('button', { name: 'Mark all read' }).click();
		const dialog = page.getByRole('dialog', { name: 'Mark all as read?' });
		await expect(dialog).toContainText('in feed “Bun Blog”');
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		expect(markAllRequests).toBe(0);
		await expect(page.getByRole('button', { name: /Alpha Launch/ })).toBeVisible();
	});
});
