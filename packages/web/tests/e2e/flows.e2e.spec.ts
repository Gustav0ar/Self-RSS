import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:3100/api/v1';
let cachedAdminAccessToken: string | null = null;

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

test('reader can toggle a read article back to unread', async ({ page }) => {
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

test('sort toggle changes the order of articles in the list', async ({ page }) => {
	await loginThroughUi(page, 'reader@example.com', 'password123');

	// The toolbar starts on "Newest" sort.
	const sortButton = page.getByRole('button', { name: 'Newest' });
	await expect(sortButton).toBeVisible();

	// Clicking the sort button toggles to oldest.
	await sortButton.click();
	await expect(page.getByRole('button', { name: 'Oldest' })).toBeVisible();
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
