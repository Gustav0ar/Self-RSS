import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();
const getAccessTokenMock = vi.fn();
const storedValues = new Map<string, string>();
const storage: Storage = {
	get length() {
		return storedValues.size;
	},
	clear: () => storedValues.clear(),
	getItem: (key) => storedValues.get(key) ?? null,
	key: (index) => [...storedValues.keys()][index] ?? null,
	removeItem: (key) => storedValues.delete(key),
	setItem: (key, value) => storedValues.set(key, value),
};

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

vi.mock('../../src/lib/api', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
	getAccessToken: () => getAccessTokenMock(),
}));

import {
	flushProductAnalyticsEvents,
	queueProductAnalyticsEvent,
	setProductAnalyticsUser,
	trackArticleCompletion,
	trackProductAnalyticsAppOpen,
} from '../../src/lib/product-analytics';

describe('product analytics queue', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		setProductAnalyticsUser(null);
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
		getAccessTokenMock.mockReturnValue(null);
		apiFetchMock.mockResolvedValue({ data: { accepted: 1 } });
	});

	it('keeps offline events until the matching user has authenticated connectivity', async () => {
		setProductAnalyticsUser('user-1');
		queueProductAnalyticsEvent('offline_restore');
		expect(apiFetchMock).not.toHaveBeenCalled();

		Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
		getAccessTokenMock.mockReturnValue('token');
		await flushProductAnalyticsEvents();

		expect(apiFetchMock).toHaveBeenCalledWith('/analytics/events', {
			method: 'POST',
			body: expect.stringContaining('offline_restore'),
		});
		expect(localStorage.getItem('self-feed-product-analytics-v1')).toBe('[]');
	});

	it('records one dated app-open event per account and app session', () => {
		trackProductAnalyticsAppOpen('opened-user');
		trackProductAnalyticsAppOpen('opened-user');

		const pending = JSON.parse(
			localStorage.getItem('self-feed-product-analytics-v1') ?? '[]',
		) as Array<{ type: string; occurredOn: string }>;
		expect(pending).toEqual([
			{
				id: expect.any(String),
				type: 'app_opened',
				occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
				userId: 'opened-user',
			},
		]);
	});

	it('records article completion once per article and account in one app session', () => {
		setProductAnalyticsUser('user-1');
		trackArticleCompletion('article-1');
		trackArticleCompletion('article-1');

		const pending = JSON.parse(
			localStorage.getItem('self-feed-product-analytics-v1') ?? '[]',
		) as Array<{ type: string }>;
		expect(pending).toHaveLength(1);
		expect(pending[0]?.type).toBe('article_completed');
	});

	it('does not send one account pending events under another account', async () => {
		queueProductAnalyticsEvent('offline_restore', 'user-1');
		setProductAnalyticsUser('user-2');
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
		getAccessTokenMock.mockReturnValue('token');

		await flushProductAnalyticsEvents();

		expect(apiFetchMock).not.toHaveBeenCalled();
	});
});
