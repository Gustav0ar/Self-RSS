import { bearerSecurity } from './helpers';

export const realtimeSchemas = {
	FeedSyncProgressEvent: {
		type: 'object',
		required: [
			'type',
			'eventId',
			'jobId',
			'phase',
			'scope',
			'totalFeeds',
			'completedFeeds',
			'syncedFeeds',
			'failedFeeds',
			'skippedFeeds',
			'newArticles',
			'queuedAt',
			'startedAt',
			'error',
			'updatedAt',
		],
		properties: {
			type: { type: 'string', const: 'feed.sync.progress' },
			eventId: { type: 'string' },
			jobId: { type: 'string' },
			phase: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
			scope: {
				type: 'object',
				properties: {
					feedId: { type: 'string', format: 'uuid' },
					categoryId: { type: 'string', format: 'uuid' },
				},
			},
			totalFeeds: { type: 'integer', minimum: 0 },
			completedFeeds: { type: 'integer', minimum: 0 },
			syncedFeeds: { type: 'integer', minimum: 0 },
			failedFeeds: { type: 'integer', minimum: 0 },
			skippedFeeds: { type: 'integer', minimum: 0 },
			newArticles: { type: 'integer', minimum: 0 },
			queuedAt: { type: ['string', 'null'], format: 'date-time' },
			startedAt: { type: ['string', 'null'], format: 'date-time' },
			error: { type: ['string', 'null'] },
			updatedAt: { type: 'string', format: 'date-time' },
		},
	},
	FeedHealthUpdatedEvent: {
		type: 'object',
		required: [
			'type',
			'eventId',
			'feedId',
			'severity',
			'syncStatus',
			'lastSyncedAt',
			'lastSyncError',
			'lastSyncErrorAt',
			'updatedAt',
		],
		properties: {
			type: { type: 'string', const: 'feed.health.updated' },
			eventId: { type: 'string' },
			feedId: { type: 'string', format: 'uuid' },
			severity: { type: 'string', enum: ['healthy', 'warning', 'error'] },
			syncStatus: { type: 'string', enum: ['idle', 'syncing', 'error'] },
			lastSyncedAt: { type: ['string', 'null'], format: 'date-time' },
			lastSyncError: { type: ['string', 'null'] },
			lastSyncErrorAt: { type: ['string', 'null'], format: 'date-time' },
			updatedAt: { type: 'string', format: 'date-time' },
		},
	},
	ReadStateSyncEvent: {
		oneOf: [
			{ $ref: '#/components/schemas/ArticleReadStateChangedEvent' },
			{ $ref: '#/components/schemas/ArticleSavedStateChangedEvent' },
			{ $ref: '#/components/schemas/ArticlesMarkedReadEvent' },
			{ $ref: '#/components/schemas/ArticlesNewEvent' },
			{ $ref: '#/components/schemas/ArticleUpdatedEvent' },
			{ $ref: '#/components/schemas/FeedSyncProgressEvent' },
			{ $ref: '#/components/schemas/FeedHealthUpdatedEvent' },
		],
	},
} as const;

export const realtimePaths = {
	'/events/read-state': {
		get: {
			tags: ['Events'],
			security: bearerSecurity,
			description:
				'Backward-compatible server-sent event stream. Events use event name "read-state" with a ReadStateSyncEvent JSON payload.',
			responses: {
				'200': {
					description: 'Read-state event stream',
					content: {
						'text/event-stream': {
							schema: {
								type: 'string',
								description:
									'SSE stream. Each read-state event data line contains a ReadStateSyncEvent JSON payload.',
							},
						},
					},
				},
			},
		},
	},
	'/events/stream': {
		get: {
			tags: ['Events'],
			security: bearerSecurity,
			description:
				'Server-sent event stream for article, feed-sync progress, and feed-health changes. Events use event name "realtime" with a ReadStateSyncEvent JSON payload.',
			responses: {
				'200': {
					description: 'Realtime event stream',
					content: {
						'text/event-stream': {
							schema: {
								type: 'string',
								description:
									'SSE stream. Each realtime event data line contains a ReadStateSyncEvent JSON payload.',
							},
						},
					},
				},
			},
		},
	},
} as const;
