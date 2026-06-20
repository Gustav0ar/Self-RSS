import { type ReadStateSyncEvent, readStateSyncEventSchema } from '@self-feed/shared';
import type Redis from 'ioredis';
import { createLogger } from '../utils/logger.js';
import { getMetricsService } from './metrics.service.js';

type ReadStateEventHandler = (event: ReadStateSyncEvent) => void;

const logger = createLogger('realtime');

export const MAX_CONNECTIONS_PER_USER = 3;
export const MAX_RECONNECT_ATTEMPTS = 3;

function readStateChannel(userId: string) {
	return `events:user:${userId}:read-state`;
}

export class RealtimeService {
	private subscriber: Redis | null = null;
	private handlersByChannel = new Map<string, Set<ReadStateEventHandler>>();
	private connecting: Promise<void> | null = null;
	private connectionsByUser = new Map<string, number>();
	private reconnectAttempts = 0;
	private closed = false;

	constructor(private redis: Redis) {}

	async publishReadStateEvent(userId: string, event: ReadStateSyncEvent) {
		await this.redis.publish(readStateChannel(userId), JSON.stringify(event));
	}

	async subscribeToReadStateEvents(
		userId: string,
		handler: ReadStateEventHandler,
	): Promise<() => void> {
		const channel = readStateChannel(userId);
		await this.ensureSubscriber();

		// Check per-user connection limit
		const currentConnections = this.connectionsByUser.get(userId) ?? 0;
		if (currentConnections >= MAX_CONNECTIONS_PER_USER) {
			logger.warn('SSE connection rejected: user has max connections', {
				userId,
				currentConnections,
				maxConnections: MAX_CONNECTIONS_PER_USER,
			});
			throw new Error(
				`User ${userId} has reached the maximum number of connections (${MAX_CONNECTIONS_PER_USER})`,
			);
		}

		let handlers = this.handlersByChannel.get(channel);
		const firstSubscriberForChannel = !handlers;
		if (!handlers) {
			handlers = new Set();
			this.handlersByChannel.set(channel, handlers);
		}

		handlers.add(handler);

		// Track SSE connection count
		this.connectionsByUser.set(userId, currentConnections + 1);
		getMetricsService().incrementSseConnections();

		if (firstSubscriberForChannel) {
			await this.subscriber?.subscribe(channel);
		}

		let cleanedUp = false;
		return () => {
			if (cleanedUp) {
				return;
			}
			cleanedUp = true;
			void this.unsubscribe(channel, userId, handler);
		};
	}

	async close() {
		this.closed = true;
		this.handlersByChannel.clear();
		this.connectionsByUser.clear();
		this.reconnectAttempts = 0;
		await this.cleanup();
	}

	private async cleanup() {
		if (this.subscriber) {
			const subscriber = this.subscriber;
			this.subscriber = null;
			await subscriber.quit().catch(() => undefined);
		}
		this.connecting = null;
	}

	private async ensureSubscriber() {
		if (this.subscriber) {
			return;
		}

		this.closed = false;
		const subscriber = this.redis.duplicate();
		this.subscriber = subscriber;
		subscriber.on('message', (channel, message) => {
			this.handleMessage(channel, message);
		});
		subscriber.on('error', async (error) => {
			if (this.closed) {
				return;
			}

			logger.warn('Read-state subscriber error, reconnecting...', {
				error: error.message,
				attempts: this.reconnectAttempts,
			});

			if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				this.reconnectAttempts++;
				await this.cleanup();
				await this.ensureSubscriber();
			} else {
				logger.error('Max reconnection attempts reached', {
					attempts: this.reconnectAttempts,
				});
			}
		});

		this.connecting ??= subscriber
			.connect()
			.catch((error: Error) => {
				this.subscriber = null;
				throw error;
			})
			.finally(() => {
				this.connecting = null;
			});
		await this.connecting;
	}

	private handleMessage(channel: string, message: string) {
		const handlers = this.handlersByChannel.get(channel);
		if (!handlers?.size) {
			return;
		}

		let event: unknown;
		try {
			event = JSON.parse(message);
		} catch {
			logger.warn('Ignoring malformed read-state event payload');
			return;
		}

		const parsed = readStateSyncEventSchema.safeParse(event);
		if (!parsed.success) {
			logger.warn('Ignoring invalid read-state event payload');
			return;
		}

		for (const handler of handlers) {
			handler(parsed.data);
		}
	}

	private async unsubscribe(channel: string, userId: string, handler: ReadStateEventHandler) {
		const handlers = this.handlersByChannel.get(channel);
		if (!handlers) {
			return;
		}

		handlers.delete(handler);

		// Update per-user connection count
		const currentConnections = this.connectionsByUser.get(userId) ?? 0;
		if (currentConnections > 1) {
			this.connectionsByUser.set(userId, currentConnections - 1);
		} else {
			this.connectionsByUser.delete(userId);
		}

		// Track SSE connection count
		getMetricsService().decrementSseConnections();

		if (handlers.size > 0) {
			return;
		}

		this.handlersByChannel.delete(channel);
		await this.subscriber?.unsubscribe(channel).catch(() => undefined);

		if (this.handlersByChannel.size === 0 && this.subscriber) {
			const subscriber = this.subscriber;
			this.subscriber = null;
			await subscriber.quit().catch(() => undefined);
		}
	}

	/**
	 * Get the current active SSE connection count.
	 */
	getConnectionCount(): number {
		let total = 0;
		for (const handlers of this.handlersByChannel.values()) {
			total += handlers.size;
		}
		return total;
	}
}
