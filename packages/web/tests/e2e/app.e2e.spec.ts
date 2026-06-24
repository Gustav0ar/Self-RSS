import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:3100/api/v1';
let cachedAdminAccessToken: string | null = null;

function unreadBadgeName(name: string) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`^${escaped}(?: \\d+)?$`);
}

function articleTitleName(title: string) {
	const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`\\b${escaped}\\b`);
}

async function loginThroughApi(request: APIRequestContext, email: string, password: string) {
	const response = await request.post(`${apiBaseUrl}/auth/login`, {
		data: { email, password },
	});
	expect(response.ok()).toBeTruthy();
	return response.json();
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

async function loginThroughUi(page: Page, email: string, password: string) {
	await page.goto('/');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign In' }).click();
	// Wait for both the article list to load AND the authenticated UI to render
	await expect(page.getByText('All Feeds')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('user can register and sign out', async ({ page }) => {
	const email = `fresh-${Date.now()}@example.com`;
	await page.goto('/');
	await page.getByRole('button', { name: 'Register' }).click();
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password123');
	await page.getByRole('button', { name: 'Create Account' }).click();
	await expect(page.getByText(email)).toBeVisible();
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByText('Sign in to your account')).toBeVisible();
});

test('seeded user can browse articles, search, use keyboard navigation, and persist preferences', async ({
	page,
}) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');

	await expect(page.getByRole('button', { name: unreadBadgeName('Tech') })).toBeVisible();
	await page.getByRole('button', { name: unreadBadgeName('Tech') }).click();
	await page.getByRole('button', { name: unreadBadgeName('Bun Blog') }).click();
	const alphaRow = page.getByRole('button', { name: /Alpha Launch/ });
	await expect(alphaRow).toBeVisible();
	await expect(alphaRow).toContainText('Bun Blog');
	await expect(alphaRow).not.toContainText('Bun Team');
	await expect(alphaRow).not.toContainText('Alpha launch excerpt');
	await expect(alphaRow.locator('img[src="https://example.com/images/alpha.png"]')).toHaveCount(0);
	const betaRow = page.getByRole('button', { name: /Beta Update/ });
	await expect(betaRow).toBeVisible();

	await page.keyboard.press('j');
	await expect(page.getByRole('heading', { name: 'Alpha Launch' })).toBeVisible();
	await expect(alphaRow).toHaveAttribute('aria-current', 'true');
	const selectedAlphaBox = await alphaRow.boundingBox();
	expect(selectedAlphaBox?.height).toBeLessThanOrEqual(84);
	const readerVideo = page.locator('video[title="Media 1"]');
	await expect(readerVideo).toBeVisible();
	await readerVideo.scrollIntoViewIfNeeded();
	await readerVideo.click();
	await page.keyboard.press('j');
	await expect(page.getByRole('heading', { name: 'Beta Update' })).toBeVisible();
	await expect(betaRow).toHaveAttribute('aria-current', 'true');
	await page.keyboard.press('k');
	await expect(page.getByRole('heading', { name: 'Alpha Launch' })).toBeVisible();
	await expect(alphaRow).toHaveAttribute('aria-current', 'true');

	await page.getByPlaceholder('Search articles...').fill('Gamma');
	const gammaButton = page.getByRole('option', { name: /Gamma World/ });
	await expect(gammaButton).toBeVisible();
	await gammaButton.click();
	// The search-bar click navigates to /articles/:id. Wait for that
	// navigation to land and the reader pane to render the heading,
	// regardless of whether the surrounding feed-scope article list
	// still contains the article (the deep-link path renders it
	// directly from the single-article fetch).
	await page.waitForURL(/\/articles\//);
	await expect(page.getByRole('heading', { name: 'Gamma World' })).toBeVisible();

	await page.getByRole('button', { name: 'Preferences' }).click();
	await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
	await page.getByRole('combobox', { name: 'Font Family' }).selectOption('Georgia');
	await page.getByRole('checkbox', { name: 'Hide read articles' }).check();
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);

	await page.reload();
	await expect(page.getByText('All Feeds')).toBeVisible();
	await page.getByRole('button', { name: 'Preferences' }).click();
	await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
	await expect(page.getByRole('combobox', { name: 'Font Family' })).toHaveValue('Georgia');
	await expect(page.getByRole('checkbox', { name: 'Hide read articles' })).toBeChecked();
});

test('reader can manage categories and feeds from the sidebar', async ({ page }) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');
	const appOrigin = new URL(page.url()).origin;
	const categoryName = `Daily ${Date.now()}`;
	const renamedCategory = `${categoryName} Updated`;
	const emptyCategory = `Empty ${Date.now()}`;

	await page.getByRole('button', { name: 'Add Category' }).click();
	await page.getByLabel('Name').fill(categoryName);
	await page.getByRole('button', { name: 'Add category' }).last().click();
	await expect(page.getByRole('button', { name: new RegExp(`^${categoryName}$`) })).toBeVisible();

	await page.getByRole('button', { name: `Edit ${categoryName}` }).click();
	await page.getByLabel('Name').fill(renamedCategory);
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(
		page.getByRole('button', { name: new RegExp(`^${renamedCategory}$`) }),
	).toBeVisible();

	await page.getByRole('button', { name: 'Add Feed' }).click();
	await page.getByLabel('Feed URL').fill(`${appOrigin}/test-feeds/devtools.xml`);
	await page.getByLabel('Feed category').selectOption({ label: renamedCategory });
	await page.getByRole('button', { name: 'Add feed' }).last().click();
	await page.getByRole('button', { name: new RegExp(`^${renamedCategory}$`) }).click();
	await expect(
		page.getByRole('button', { name: unreadBadgeName('DevTools Digest') }),
	).toBeVisible();
	await page.getByRole('button', { name: unreadBadgeName('DevTools Digest') }).click();
	await expect(page.getByRole('button', { name: /Inspector improvements/ })).toBeVisible();

	await page.getByRole('button', { name: 'Add Category' }).click();
	await page.getByLabel('Name').fill(emptyCategory);
	await page.getByRole('button', { name: 'Add category' }).last().click();
	await expect(page.getByRole('button', { name: new RegExp(`^${emptyCategory}$`) })).toBeVisible();

	await page.getByRole('button', { name: `Delete ${emptyCategory}` }).click();
	await page.getByRole('button', { name: 'Delete' }).last().click();
	await expect(page.getByRole('heading', { name: 'Delete category' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: new RegExp(`^${emptyCategory}$`) })).toHaveCount(0);

	await page.getByRole('button', { name: 'Edit DevTools Digest' }).click();
	await page.getByLabel('Custom name (optional)').fill('My DevTools');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('button', { name: unreadBadgeName('My DevTools') })).toBeVisible();

	await page.getByRole('button', { name: 'Delete My DevTools' }).click();
	await page.getByRole('button', { name: 'Delete' }).last().click();
	await expect(page.getByRole('heading', { name: 'Delete feed' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: unreadBadgeName('My DevTools') })).toHaveCount(0);
});

test('user can refresh a feed, see unread badges update, and load older articles on scroll', async ({
	page,
}) => {
	const email = `scroll-${Date.now()}@example.com`;
	await page.goto('/');
	await page.getByRole('button', { name: 'Register' }).click();
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password123');
	await page.getByRole('button', { name: 'Create Account' }).click();
	await expect(page.getByText(email)).toBeVisible();

	const appOrigin = new URL(page.url()).origin;
	const categoryName = `Scroll ${Date.now()}`;

	await page.getByRole('button', { name: 'Add Category' }).click();
	await page.getByLabel('Name').fill(categoryName);
	await page.getByRole('button', { name: 'Add category' }).last().click();
	await page.getByRole('button', { name: new RegExp(`^${categoryName}$`) }).click();

	await page.getByRole('button', { name: 'Add Feed' }).click();
	await page.getByLabel('Feed URL').fill(`${appOrigin}/test-feeds/infinite-scroll.xml`);
	await page.getByLabel('Feed category').selectOption({ label: categoryName });
	await page.getByRole('button', { name: 'Add feed' }).last().click();

	const feedButton = page.getByRole('button', { name: unreadBadgeName('Infinite Scroll Digest') });
	await expect(feedButton).toBeVisible();
	await feedButton.click();

	await expect(
		page.getByRole('button', { name: articleTitleName('Infinite Story 35') }),
	).toBeVisible();
	await expect(feedButton).toContainText('35');
	await expect(page.getByRole('button', { name: /All Feeds/ })).toContainText('35');
	await expect(
		page.getByRole('button', { name: articleTitleName('Infinite Story 5') }),
	).toHaveCount(0);

	await page.getByRole('button', { name: articleTitleName('Infinite Story 35') }).click();
	await expect(page.getByRole('heading', { name: 'Infinite Story 35', level: 1 })).toBeVisible();
	await expect(feedButton).toContainText('34');
	await expect(page.getByRole('button', { name: /All Feeds/ })).toContainText('34');

	const refreshPromise = page.waitForResponse(
		(res) => res.url().includes('/api/v1/articles') && res.status() === 200,
	);
	await page.getByRole('button', { name: 'Refresh' }).click();
	await refreshPromise;

	await expect(
		page.getByRole('button', { name: articleTitleName('Infinite Story 35') }),
	).toBeVisible();

	await page.getByTestId('article-list-scroll').evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(
		page.getByRole('button', { name: articleTitleName('Infinite Story 5') }),
	).toBeVisible();
	const oldestArticle = page.getByRole('button', { name: articleTitleName('Infinite Story 1') });
	await oldestArticle.scrollIntoViewIfNeeded();
	await expect(oldestArticle).toBeVisible();
});

test('reader sees the category delete warning for linked feeds and can import OPML files', async ({
	page,
}) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');
	const appOrigin = new URL(page.url()).origin;
	const categoryName = `Linked ${Date.now()}`;

	await page.getByRole('button', { name: 'Add Category' }).click();
	await page.getByLabel('Name').fill(categoryName);
	await page.getByRole('button', { name: 'Add category' }).last().click();

	await page.getByRole('button', { name: 'Add Feed' }).click();
	await page.getByLabel('Feed URL').fill(`${appOrigin}/test-feeds/platform.xml`);
	await page.getByLabel('Feed category').selectOption({ label: categoryName });
	await page.getByRole('button', { name: 'Add feed' }).last().click();
	await page.getByRole('button', { name: new RegExp(`^${categoryName}$`) }).click();
	await expect(
		page.getByRole('button', { name: unreadBadgeName('Platform Weekly') }),
	).toBeVisible();

	await page.getByRole('button', { name: `Delete ${categoryName}` }).click();
	await expect(
		page.getByText('server will block deletion until they are moved or removed'),
	).toBeVisible();
	await page.getByRole('button', { name: 'Try delete' }).last().click();
	await expect(
		page.getByText('Cannot delete category with feeds. Move or delete feeds first.'),
	).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();

	await page.getByRole('button', { name: 'Import OPML' }).click();
	const opmlInput = page.getByLabel('OPML file');
	const opml = `<?xml version="1.0" encoding="UTF-8"?>
		<opml version="2.0">
			<body>
				<outline text="Imported Group">
					<outline text="Imported Subgroup">
						<outline text="DevTools Digest" xmlUrl="${appOrigin}/test-feeds/devtools.xml" />
						<outline text="Platform Weekly" xmlUrl="${appOrigin}/test-feeds/platform.xml" />
						<outline text="DevTools Digest Duplicate" xmlUrl="${appOrigin}/test-feeds/devtools.xml" />
					</outline>
				</outline>
			</body>
		</opml>`;
	await opmlInput.setInputFiles({
		name: 'feeds.opml',
		mimeType: 'text/xml',
		buffer: Buffer.from(opml),
	});
	await page.getByRole('button', { name: 'Import feeds' }).click();
	await expect(page.getByText('Import summary')).toBeVisible();
	await expect(page.getByText('Created categories')).toBeVisible();
	await expect(page.getByText('Skipped duplicates')).toBeVisible();
	await expect(page.getByRole('button', { name: unreadBadgeName('Imported Group') })).toBeVisible();

	await page.getByRole('button', { name: 'Close' }).click();
	await page.getByRole('button', { name: 'Import OPML' }).click();
	await opmlInput.setInputFiles({
		name: 'broken.opml',
		mimeType: 'text/xml',
		buffer: Buffer.from('not xml'),
	});
	await page.getByRole('button', { name: 'Import feeds' }).click();
	await expect(page.getByText('Invalid OPML file')).toBeVisible();
});

test('admin can lock registration and registration button is hidden', async ({ page, request }) => {
	await setRegistrationLocked(request, true);
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Register' })).toBeHidden();

	// Verify direct API registration is blocked
	const response = await request.post(`${apiBaseUrl}/auth/register`, {
		data: {
			email: `blocked-${Date.now()}@example.com`,
			password: 'password123',
		},
	});
	expect(response.status()).toBe(403);
	const body = await response.json();
	expect(body.error.message).toContain('Registration is currently closed');
});
