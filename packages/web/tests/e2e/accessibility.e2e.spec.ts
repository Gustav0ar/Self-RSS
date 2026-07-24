import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, type TestInfo, test } from '@playwright/test';

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:3100/api/v1';

async function loginThroughUi(page: Page, email = 'reader@example.com') {
	await page.goto('/');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password123');
	await page.getByRole('button', { name: 'Sign In' }).click();
	await expect(page.getByText('All Feeds')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function ensureRegistrationUnlocked(request: APIRequestContext) {
	const login = await request.post(`${apiBaseUrl}/auth/login`, {
		data: { email: 'admin@example.com', password: 'password123' },
	});
	expect(login.ok()).toBeTruthy();
	const body = await login.json();
	const update = await request.patch(`${apiBaseUrl}/admin/settings`, {
		headers: { Authorization: `Bearer ${body.data.tokens.accessToken}` },
		data: { registrationLocked: false },
	});
	expect(update.ok()).toBeTruthy();
}

async function expectNoSeriousAccessibilityViolations(
	page: Page,
	testInfo: TestInfo,
	stateName: string,
) {
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document
						.getAnimations()
						.filter(
							(animation) =>
								animation.playState === 'running' &&
								animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY,
						).length,
			),
		)
		.toBe(0);
	const results = await new AxeBuilder({ page }).analyze();
	await testInfo.attach(`axe-${stateName}`, {
		body: JSON.stringify(results, null, 2),
		contentType: 'application/json',
	});
	const blockingViolations = results.violations.filter(
		(violation) => violation.impact === 'serious' || violation.impact === 'critical',
	);
	expect(
		blockingViolations,
		`${stateName} has serious or critical accessibility violations:\n${JSON.stringify(
			blockingViolations,
			null,
			2,
		)}`,
	).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test('login has no serious or critical axe violations', async ({ page }, testInfo) => {
	await page.goto('/');
	await expect(page.getByText('Sign in to your account')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();
	await expectNoSeriousAccessibilityViolations(page, testInfo, 'login');
});

test('empty onboarding has no serious or critical axe violations', async ({
	page,
	request,
}, testInfo) => {
	await ensureRegistrationUnlocked(request);
	const email = `axe-empty-${Date.now()}@example.com`;
	await page.goto('/');
	await page.getByRole('button', { name: 'Register' }).click();
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('password123');
	await page.getByRole('button', { name: 'Create Account' }).click();
	await expect(page.getByText('No articles yet')).toBeVisible();
	await expectNoSeriousAccessibilityViolations(page, testInfo, 'empty-onboarding');
});

test('populated reader has no serious or critical axe violations', async ({ page }, testInfo) => {
	let readStateWrites = 0;
	await page.route('**/api/v1/articles/*/read', async (route) => {
		readStateWrites += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ data: { success: true } }),
		});
	});
	await loginThroughUi(page);
	await page.getByRole('button', { name: /Alpha Launch/ }).click();
	await expect(page.getByRole('heading', { name: 'Alpha Launch' })).toBeVisible();
	await expect.poll(() => readStateWrites).toBe(1);
	await expectNoSeriousAccessibilityViolations(page, testInfo, 'populated-reader');
});

test('preferences has no serious or critical axe violations', async ({ page }, testInfo) => {
	await loginThroughUi(page);
	await page.getByRole('button', { name: 'Preferences' }).click();
	await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
	await expectNoSeriousAccessibilityViolations(page, testInfo, 'preferences');
});

test('feed management has no serious or critical axe violations', async ({ page }, testInfo) => {
	await loginThroughUi(page);
	await page.getByRole('button', { name: 'Add Feed' }).click();
	await expect(page.getByRole('dialog', { name: 'Add Feed' })).toBeVisible();
	await expectNoSeriousAccessibilityViolations(page, testInfo, 'feed-management');
});
