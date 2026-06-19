const apiBaseUrl = process.env.LOCAL_REVIEW_API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const email = process.env.LOCAL_REVIEW_EMAIL ?? 'reader@example.com';
const password = process.env.LOCAL_REVIEW_PASSWORD ?? 'password123';
const categoryName = process.env.LOCAL_REVIEW_CATEGORY ?? 'Review Feeds';

const reviewFeeds = [
	{ title: 'BBC World', feedUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
	{ title: 'The Verge', feedUrl: 'https://www.theverge.com/rss/index.xml' },
	{ title: 'xkcd', feedUrl: 'https://xkcd.com/rss.xml' },
	{ title: 'NASA News Releases', feedUrl: 'https://www.nasa.gov/news-release/feed/' },
];

interface ApiOptions extends RequestInit {
	token?: string;
}

interface ApiEnvelope<T> {
	data: T;
}

interface AuthData {
	tokens: {
		accessToken: string;
	};
}

interface Category {
	id: string;
	name: string;
	children?: Category[];
	categories?: Category[];
}

interface Feed {
	id: string;
	title: string;
	feedUrl: string;
}

function errorMessageFromBody(body: unknown, fallback: string) {
	if (
		body &&
		typeof body === 'object' &&
		'error' in body &&
		body.error &&
		typeof body.error === 'object' &&
		'message' in body.error &&
		typeof body.error.message === 'string'
	) {
		return body.error.message;
	}
	return fallback;
}

async function api<T>(path: string, options: ApiOptions = {}) {
	const headers = new Headers(options.headers);
	headers.set('accept', 'application/json');
	if (options.body && !headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}
	if (options.token) {
		headers.set('authorization', `Bearer ${options.token}`);
	}

	const response = await fetch(`${apiBaseUrl}${path}`, {
		...options,
		headers,
	});
	const text = await response.text();
	const body = text ? (JSON.parse(text) as unknown) : null;
	if (!response.ok) {
		const message = errorMessageFromBody(body, response.statusText);
		throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${message}`);
	}
	return body as T;
}

async function login() {
	const body = await api<ApiEnvelope<AuthData>>('/auth/login', {
		method: 'POST',
		body: JSON.stringify({ email, password }),
	});
	return body.data.tokens.accessToken;
}

async function ensureLogin() {
	try {
		return await login();
	} catch {
		console.log(`Local review user ${email} does not exist yet; registering it.`);
		try {
			await api('/auth/register', {
				method: 'POST',
				body: JSON.stringify({ email, password }),
			});
		} catch (registerError) {
			throw new Error(
				`Could not create ${email}. If registration is locked, run from packages/api: bun ../../scripts/seed-e2e.ts. ${String(registerError)}`,
			);
		}
		return login();
	}
}

function flattenCategories(categories: Category[]): Category[] {
	return categories.flatMap((category) => [
		category,
		...flattenCategories(category.children ?? category.categories ?? []),
	]);
}

async function ensureCategory(token: string) {
	const categoryTree = await api<ApiEnvelope<{ categories: Category[] }>>('/categories', { token });
	const existing = flattenCategories(categoryTree.data.categories ?? []).find(
		(category) => category.name === categoryName,
	);
	if (existing) return existing.id;

	const created = await api<ApiEnvelope<Category>>('/categories', {
		method: 'POST',
		token,
		body: JSON.stringify({ name: categoryName, sortOrder: 99 }),
	});
	return created.data.id;
}

async function ensureFeeds(token: string, categoryId: string) {
	const feedsResponse = await api<ApiEnvelope<Feed[]>>('/feeds', { token });
	const existingFeeds = new Map<string, Feed>(
		(feedsResponse.data ?? []).map((feed) => [feed.feedUrl, feed]),
	);
	const reviewFeedIds: string[] = [];

	for (const feed of reviewFeeds) {
		const existing = existingFeeds.get(feed.feedUrl);
		if (existing) {
			console.log(`Feed exists: ${existing.title} (${feed.feedUrl})`);
			reviewFeedIds.push(existing.id);
			continue;
		}

		const created = await api<ApiEnvelope<Feed>>('/feeds', {
			method: 'POST',
			token,
			body: JSON.stringify({ ...feed, categoryId }),
		});
		console.log(`Feed created: ${created.data.title} (${feed.feedUrl})`);
		reviewFeedIds.push(created.data.id);
	}

	return reviewFeedIds;
}

async function syncFeeds(token: string, feedIds: string[]) {
	for (const feedId of feedIds) {
		try {
			await api(`/feeds/${feedId}/sync`, { method: 'POST', token });
		} catch (error) {
			console.warn(`Feed sync skipped for ${feedId}: ${String(error)}`);
		}
	}
}

async function main() {
	await apiBaseHealthCheck();
	const token = await ensureLogin();
	const categoryId = await ensureCategory(token);
	const feedIds = await ensureFeeds(token, categoryId);
	await syncFeeds(token, feedIds);

	const articles = await api<ApiEnvelope<unknown[]>>('/articles?limit=5', { token });
	const articleCount = Array.isArray(articles.data) ? articles.data.length : 0;
	console.log(`Local review login: ${email} / ${password}`);
	console.log(`Review feeds ready: ${reviewFeeds.length}`);
	console.log(`Latest articles returned by API: ${articleCount}`);
	console.log('Open http://localhost:5173/ and sign in with the local review login.');
}

async function apiBaseHealthCheck() {
	const healthUrl = apiBaseUrl.replace(/\/api\/v1\/?$/, '/health');
	const response = await fetch(healthUrl);
	if (!response.ok) {
		throw new Error(`Local API is not healthy at ${healthUrl}`);
	}
}

await main();
