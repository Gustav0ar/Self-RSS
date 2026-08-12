import type {
	ApiResponse,
	ProductAnalyticsEvent,
	ProductAnalyticsEventType,
	RecordProductAnalyticsEventsResponse,
} from '@self-feed/shared';
import { apiFetch, getAccessToken } from './api';

const STORAGE_KEY = 'self-feed-product-analytics-v1';
const MAX_PENDING_EVENTS = 50;

interface PendingProductAnalyticsEvent extends ProductAnalyticsEvent {
	userId: string;
}

let activeUserId: string | null = null;
let flushPromise: Promise<void> | null = null;
const completedArticles = new Set<string>();
const openedAccounts = new Set<string>();

function utcToday() {
	return new Date().toISOString().slice(0, 10);
}

function loadPendingEvents(): PendingProductAnalyticsEvent[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(event): event is PendingProductAnalyticsEvent =>
				typeof event === 'object' &&
				event !== null &&
				typeof event.id === 'string' &&
				(event.type === 'app_opened' ||
					event.type === 'offline_restore' ||
					event.type === 'article_completed') &&
				typeof event.occurredOn === 'string' &&
				typeof event.userId === 'string',
		);
	} catch {
		return [];
	}
}

function savePendingEvents(events: PendingProductAnalyticsEvent[]) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_PENDING_EVENTS)));
	} catch {
		// Analytics is best-effort and must never block the reader.
	}
}

export function setProductAnalyticsUser(userId: string | null) {
	activeUserId = userId;
}

export function queueProductAnalyticsEvent(type: ProductAnalyticsEventType, userId = activeUserId) {
	if (!userId) return;
	const pending = loadPendingEvents();
	pending.push({ id: crypto.randomUUID(), type, occurredOn: utcToday(), userId });
	savePendingEvents(pending);
	void flushProductAnalyticsEvents();
}

export function trackProductAnalyticsAppOpen(userId = activeUserId) {
	const occurredOn = utcToday();
	const key = userId ? `${userId}:${occurredOn}` : null;
	if (!userId || !key || openedAccounts.has(key)) return;
	openedAccounts.add(key);
	queueProductAnalyticsEvent('app_opened', userId);
}

export function trackArticleCompletion(articleId: string) {
	if (!activeUserId) return;
	const key = `${activeUserId}:${articleId}`;
	if (completedArticles.has(key)) return;
	completedArticles.add(key);
	queueProductAnalyticsEvent('article_completed');
}

export function flushProductAnalyticsEvents(): Promise<void> {
	if (flushPromise) return flushPromise;
	if (!activeUserId || !getAccessToken() || !navigator.onLine) return Promise.resolve();

	flushPromise = (async () => {
		const currentUserId = activeUserId;
		if (!currentUserId) return;
		const pending = loadPendingEvents();
		const events = pending
			.filter((event) => event.userId === currentUserId)
			.map(({ id, type, occurredOn }) => ({ id, type, occurredOn }));
		if (events.length === 0) return;

		try {
			await apiFetch<ApiResponse<RecordProductAnalyticsEventsResponse>>('/analytics/events', {
				method: 'POST',
				body: JSON.stringify({ events }),
			});
			const sentIds = new Set(events.map((event) => event.id));
			savePendingEvents(loadPendingEvents().filter((event) => !sentIds.has(event.id)));
		} catch {
			// Keep the bounded queue for the next authenticated online session.
		}
	})().finally(() => {
		flushPromise = null;
	});

	return flushPromise;
}
