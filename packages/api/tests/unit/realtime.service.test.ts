import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
	MAX_CONNECTIONS_PER_USER,
	MAX_RECONNECT_ATTEMPTS,
	RealtimeService,
} from '../../src/services/realtime.service.js';

/**
 * In-memory Redis stand-in. The publish/subscribe primitives share a single
 * bus between the main connection and any duplicates created via
 * `duplicate()`. When something publishes on the main connection we route
 * the message to every subscriber on the bus, which is what the real
 * ioredis client does on the wire.
 */
class FakeRedis extends EventEmitter {
	bus: { subscribers: Map<string, Set<FakeRedis>> };

	constructor(bus?: { subscribers: Map<string, Set<FakeRedis>> }) {
		super();
		this.bus = bus ?? { subscribers: new Map() };
	}

	duplicate() {
		return new FakeRedis(this.bus);
	}

	async publish(channel: string, payload: string) {
		const subscribers = this.bus.subscribers.get(channel);
		if (!subscribers) return 0;
		for (const subscriber of subscribers) {
			subscriber.emit('message', channel, payload);
		}
		return subscribers.size;
	}

	async subscribe(channel: string) {
		let set = this.bus.subscribers.get(channel);
		if (!set) {
			set = new Set();
			this.bus.subscribers.set(channel, set);
		}
		set.add(this);
		return 1;
	}

	async unsubscribe(channel: string) {
		const set = this.bus.subscribers.get(channel);
		set?.delete(this);
		if (set && set.size === 0) {
			this.bus.subscribers.delete(channel);
		}
		return 1;
	}

	async quit() {
		for (const [channel, subscribers] of this.bus.subscribers) {
			subscribers.delete(this);
			if (subscribers.size === 0) {
				this.bus.subscribers.delete(channel);
			}
		}
		return 'OK';
	}

	async connect() {
		queueMicrotask(() => this.emit('connect'));
		return undefined;
	}
}

describe('RealtimeService - publish / subscribe', () => {
	it('delivers a valid read_state_changed event to the matching subscriber', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		const received: unknown[] = [];
		await service.subscribeToReadStateEvents('user-1', (event) => {
			received.push(event);
		});

		await service.publishReadStateEvent('user-1', {
			type: 'article.read_state_changed',
			eventId: 'evt-1',
			articleId: 'article-1',
			feedId: 'feed-1',
			isRead: true,
			source: 'manual',
			clientId: null,
			updatedAt: '2026-01-01T00:00:00.000Z',
		});

		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			type: 'article.read_state_changed',
			articleId: 'article-1',
			isRead: true,
		});
	});

	it('isolates events to the matching user channel', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		const receivedA: unknown[] = [];
		const receivedB: unknown[] = [];
		await service.subscribeToReadStateEvents('user-a', (event) => receivedA.push(event));
		await service.subscribeToReadStateEvents('user-b', (event) => receivedB.push(event));

		await service.publishReadStateEvent('user-a', {
			type: 'articles.marked_read',
			eventId: 'evt-2',
			feedIds: ['feed-1'],
			scope: {},
			markedCount: 1,
			clientId: null,
			updatedAt: '2026-01-01T00:00:00.000Z',
		});

		expect(receivedA).toHaveLength(1);
		expect(receivedB).toHaveLength(0);
	});

	it('ignores malformed JSON and events that do not match the schema', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		const received: unknown[] = [];
		await service.subscribeToReadStateEvents('user-1', (event) => received.push(event));

		const otherClient = new FakeRedis(redis.bus);
		await otherClient.publish('events:user:user-1:read-state', 'not json');
		await otherClient.publish(
			'events:user:user-1:read-state',
			JSON.stringify({ type: 'unknown_event' }),
		);
		await otherClient.publish(
			'events:user:user-1:read-state',
			JSON.stringify({
				type: 'article.read_state_changed',
				articleId: 'article-1',
				feedId: 'feed-1',
				isRead: true,
			}),
		);
		await otherClient.publish(
			'events:user:user-1:read-state',
			JSON.stringify({
				type: 'articles.marked_read',
				eventId: 'evt-invalid',
				feedIds: ['feed-1'],
				scope: {},
				markedCount: -1,
				clientId: null,
				updatedAt: '2026-01-01T00:00:00.000Z',
			}),
		);

		expect(received).toEqual([]);
	});
});

describe('RealtimeService - close', () => {
	it('clears handlers and quits the subscriber', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		await service.subscribeToReadStateEvents('user-1', () => undefined);
		await service.close();

		await expect(
			service.publishReadStateEvent('user-1', {
				type: 'article.read_state_changed',
				eventId: 'evt-3',
				articleId: 'article-1',
				feedId: 'feed-1',
				isRead: true,
				source: 'manual',
				clientId: null,
				updatedAt: '2026-01-01T00:00:00.000Z',
			}),
		).resolves.toBeUndefined();
	});
});

describe('RealtimeService - per-user connection limits', () => {
	it('allows up to MAX_CONNECTIONS_PER_USER connections for a single user', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		const handlers = Array.from({ length: MAX_CONNECTIONS_PER_USER }, () => vi.fn());
		for (const handler of handlers) {
			await service.subscribeToReadStateEvents('user-1', handler);
		}

		// All connections should succeed
		expect(service.getConnectionCount()).toBe(MAX_CONNECTIONS_PER_USER);
	});

	it('rejects connection when user already has MAX_CONNECTIONS_PER_USER', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		// Create MAX connections
		const handlers = Array.from({ length: MAX_CONNECTIONS_PER_USER }, () => vi.fn());
		for (const handler of handlers) {
			await service.subscribeToReadStateEvents('user-1', handler);
		}

		// The next connection should be rejected
		await expect(service.subscribeToReadStateEvents('user-1', vi.fn())).rejects.toThrow(
			`User user-1 has reached the maximum number of connections (${MAX_CONNECTIONS_PER_USER})`,
		);

		// Connection count should remain at MAX
		expect(service.getConnectionCount()).toBe(MAX_CONNECTIONS_PER_USER);
	});

	it('allows a different user to connect even when first user is at limit', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		// User 1 reaches limit
		const user1Handlers = Array.from({ length: MAX_CONNECTIONS_PER_USER }, () => vi.fn());
		for (const handler of user1Handlers) {
			await service.subscribeToReadStateEvents('user-1', handler);
		}

		// User 2 should still be able to connect
		const user2Handler = vi.fn();
		await expect(service.subscribeToReadStateEvents('user-2', user2Handler)).resolves.toBeDefined();

		// User 1 should still be at limit
		expect(service.getConnectionCount()).toBe(MAX_CONNECTIONS_PER_USER + 1);
	});

	it('allows reconnection after a handler is removed', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		// Create MAX connections
		const handlers = Array.from({ length: MAX_CONNECTIONS_PER_USER }, () => vi.fn());
		const unsubscribes = [];
		for (const handler of handlers) {
			const unsubscribe = await service.subscribeToReadStateEvents('user-1', handler);
			unsubscribes.push(unsubscribe);
		}

		// Remove one connection
		unsubscribes[0]!();

		// Should be able to add a new connection
		const newHandler = vi.fn();
		await expect(service.subscribeToReadStateEvents('user-1', newHandler)).resolves.toBeDefined();

		// Connection count should be back at MAX
		expect(service.getConnectionCount()).toBe(MAX_CONNECTIONS_PER_USER);
	});

	it('clears connectionsByUser on close', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		// Create connections for multiple users
		await service.subscribeToReadStateEvents('user-1', vi.fn());
		await service.subscribeToReadStateEvents('user-2', vi.fn());

		await service.close();

		// After close, new connections should work
		const handler = vi.fn();
		await expect(service.subscribeToReadStateEvents('user-1', handler)).resolves.toBeDefined();
	});
});

describe('RealtimeService - reconnection logic', () => {
	it('waits for an in-flight subscriber connection before subscribing concurrent callers', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		let resolveConnect: (() => void) | undefined;
		let subscribeCalls = 0;
		const originalDuplicate = redis.duplicate.bind(redis);
		redis.duplicate = (...args) => {
			const fakeSubscriber = originalDuplicate(...args);
			fakeSubscriber.connect = async () => {
				await new Promise<void>((resolve) => {
					resolveConnect = resolve;
				});
				return undefined;
			};

			const originalSubscribe = fakeSubscriber.subscribe.bind(fakeSubscriber);
			fakeSubscriber.subscribe = async (...subscribeArgs) => {
				subscribeCalls++;
				return originalSubscribe(...subscribeArgs);
			};
			return fakeSubscriber;
		};

		const firstSubscription = service.subscribeToReadStateEvents('user-1', vi.fn());
		await Promise.resolve();
		expect(resolveConnect).toBeDefined();

		let secondSubscriptionResolved = false;
		const secondSubscription = service
			.subscribeToReadStateEvents('user-2', vi.fn())
			.then((unsubscribe) => {
				secondSubscriptionResolved = true;
				return unsubscribe;
			});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(secondSubscriptionResolved).toBe(false);
		expect(subscribeCalls).toBe(0);

		resolveConnect!();

		await Promise.all([firstSubscription, secondSubscription]);
		expect(secondSubscriptionResolved).toBe(true);
		expect(subscribeCalls).toBe(2);
	});

	it('reconnects on subscriber error within retry limit', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		// Capture the error handler (async because it calls ensureSubscriber)
		let errorHandler: (error: Error) => Promise<void>;
		const originalDuplicate = redis.duplicate.bind(redis);
		let subscriberCount = 0;
		redis.duplicate = (...args) => {
			subscriberCount++;
			const fakeSubscriber = originalDuplicate(...args);
			// Intercept error handler registration
			const originalOn = fakeSubscriber.on.bind(fakeSubscriber);
			fakeSubscriber.on = (event: string, handler: (...args: unknown[]) => void) => {
				if (event === 'error') {
					errorHandler = handler as (error: Error) => Promise<void>;
				}
				return originalOn(event, handler);
			};
			return fakeSubscriber;
		};

		// Subscribe to trigger subscriber creation
		await service.subscribeToReadStateEvents('user-1', vi.fn());

		// Initial subscriber created
		expect(subscriberCount).toBe(1);

		// Simulate an error (await because error handler is async)
		const mockError = new Error('Connection lost');
		await errorHandler!(mockError);

		// Should have reconnected (new subscriber created)
		expect(subscriberCount).toBe(2);
	});

	it('stops reconnecting after max attempts', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		// Capture the error handler
		let errorHandler: (error: Error) => Promise<void>;
		const originalDuplicate = redis.duplicate.bind(redis);
		let subscriberCount = 0;
		redis.duplicate = (...args) => {
			subscriberCount++;
			const fakeSubscriber = originalDuplicate(...args);
			const originalOn = fakeSubscriber.on.bind(fakeSubscriber);
			fakeSubscriber.on = (event: string, handler: (...args: unknown[]) => void) => {
				if (event === 'error') {
					errorHandler = handler as (error: Error) => Promise<void>;
				}
				return originalOn(event, handler);
			};
			return fakeSubscriber;
		};

		// Subscribe to trigger subscriber creation
		await service.subscribeToReadStateEvents('user-1', vi.fn());

		// Initial subscriber
		expect(subscriberCount).toBe(1);

		// Simulate errors up to the limit
		const mockError = new Error('Connection lost');
		for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
			await errorHandler!(mockError);
		}

		// Should have attempted reconnect MAX_RECONNECT_ATTEMPTS times
		// Initial + reconnect attempts
		expect(subscriberCount).toBe(MAX_RECONNECT_ATTEMPTS + 1);
	});

	it('resets reconnect attempts on close', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		// Capture the error handler
		let errorHandler: (error: Error) => Promise<void>;
		const originalDuplicate = redis.duplicate.bind(redis);
		let subscriberCount = 0;
		redis.duplicate = (...args) => {
			subscriberCount++;
			const fakeSubscriber = originalDuplicate(...args);
			const originalOn = fakeSubscriber.on.bind(fakeSubscriber);
			fakeSubscriber.on = (event: string, handler: (...args: unknown[]) => void) => {
				if (event === 'error') {
					errorHandler = handler as (error: Error) => Promise<void>;
				}
				return originalOn(event, handler);
			};
			return fakeSubscriber;
		};

		// Subscribe to trigger subscriber creation
		await service.subscribeToReadStateEvents('user-1', vi.fn());

		// Simulate an error
		await errorHandler!(new Error('Connection lost'));
		expect(subscriberCount).toBe(2);

		// Close should reset reconnect attempts and mark service as closed
		await service.close();

		// Subscribe again - this creates a new subscriber
		await service.subscribeToReadStateEvents('user-2', vi.fn());

		// Simulate another error - should NOT reconnect because service is closed
		await errorHandler!(new Error('Connection lost'));

		// Initial (user-1) + reconnect (user-1) + close + new subscriber (user-2)
		// Old error handler should not trigger reconnect because service is closed
		expect(subscriberCount).toBe(4);
	});

	it('subscribes to existing channels after reconnection', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		let errorHandler: (error: Error) => Promise<void>;
		const originalDuplicate = redis.duplicate.bind(redis);
		redis.duplicate = (...args) => {
			const fakeSubscriber = originalDuplicate(...args);
			const originalOn = fakeSubscriber.on.bind(fakeSubscriber);
			fakeSubscriber.on = (event: string, handler: (...args: unknown[]) => void) => {
				if (event === 'error') {
					errorHandler = handler as (error: Error) => Promise<void>;
				}
				return originalOn(event, handler);
			};
			return fakeSubscriber;
		};

		const received: unknown[] = [];
		const handler = vi.fn((event) => received.push(event));
		await service.subscribeToReadStateEvents('user-1', handler);

		await errorHandler!(new Error('Connection lost'));
		await service.publishReadStateEvent('user-1', {
			type: 'article.read_state_changed',
			eventId: 'evt-reconnected',
			articleId: 'article-1',
			feedId: 'feed-1',
			isRead: true,
			source: 'manual',
			clientId: null,
			updatedAt: '2026-01-01T00:00:00.000Z',
		});

		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			type: 'article.read_state_changed',
			eventId: 'evt-reconnected',
		});
	});

	it('clears reconnect attempts on close', async () => {
		const redis = new FakeRedis();
		const service = new RealtimeService(redis as never);

		// Capture the error handler
		let errorHandler: (error: Error) => Promise<void>;
		const originalDuplicate = redis.duplicate.bind(redis);
		let subscriberCount = 0;
		redis.duplicate = (...args) => {
			subscriberCount++;
			const fakeSubscriber = originalDuplicate(...args);
			const originalOn = fakeSubscriber.on.bind(fakeSubscriber);
			fakeSubscriber.on = (event: string, handler: (...args: unknown[]) => void) => {
				if (event === 'error') {
					errorHandler = handler as (error: Error) => Promise<void>;
				}
				return originalOn(event, handler);
			};
			return fakeSubscriber;
		};

		await service.subscribeToReadStateEvents('user-1', vi.fn());
		await errorHandler!(new Error('Connection lost'));

		await service.close();

		// After close, reconnect attempts should be reset
		await service.subscribeToReadStateEvents('user-2', vi.fn());

		// Should NOT reconnect since service is closed
		await errorHandler!(new Error('Another error'));
		// Initial + reconnect + close + new subscriber
		expect(subscriberCount).toBe(4);
	});
});
