import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { RealtimeService } from '../../src/services/realtime.service.js';

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
