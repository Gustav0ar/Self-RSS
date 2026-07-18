import { apiDataRef, bearerSecurity, json } from './helpers';

export const durableFeedSchemas = {
	FeedRefreshItemStatus: {
		type: 'object',
		required: [
			'feedId',
			'sourceId',
			'jobId',
			'status',
			'feedTitle',
			'errorCode',
			'errorDetails',
			'nextEligibleAt',
			'publisherRequestStarted',
			'lastFetchAt',
		],
		properties: {
			feedId: { type: ['string', 'null'], format: 'uuid' },
			sourceId: { type: ['string', 'null'], format: 'uuid' },
			jobId: { type: ['string', 'null'], format: 'uuid' },
			status: { type: 'string' },
			feedTitle: { type: ['string', 'null'] },
			errorCode: { type: ['string', 'null'] },
			errorDetails: { type: ['string', 'null'] },
			nextEligibleAt: { type: ['string', 'null'], format: 'date-time' },
			publisherRequestStarted: { type: 'boolean' },
			lastFetchAt: { type: ['string', 'null'], format: 'date-time' },
		},
	},
	FeedSyncAllStatus: {
		type: 'object',
		required: [
			'queued',
			'running',
			'active',
			'stale',
			'queuedAt',
			'startedAt',
			'heartbeatAt',
			'totalFeeds',
			'completedFeeds',
			'syncedFeeds',
			'failedFeeds',
			'skippedFeeds',
			'newArticles',
			'articleRevision',
			'jobId',
			'scope',
			'items',
		],
		properties: {
			requestId: { type: ['string', 'null'], format: 'uuid' },
			status: {
				type: 'string',
				enum: ['pending', 'running', 'completed', 'completed_with_errors'],
			},
			queued: { type: 'boolean' },
			running: { type: 'boolean' },
			active: { type: 'boolean' },
			stale: { type: 'boolean' },
			queuedAt: { type: 'string', format: 'date-time', nullable: true },
			startedAt: { type: 'string', format: 'date-time', nullable: true },
			heartbeatAt: { type: 'string', format: 'date-time', nullable: true },
			totalFeeds: { type: 'integer', minimum: 0 },
			completedFeeds: { type: 'integer', minimum: 0 },
			syncedFeeds: { type: 'integer', minimum: 0 },
			failedFeeds: { type: 'integer', minimum: 0 },
			skippedFeeds: { type: 'integer', minimum: 0 },
			pendingFeeds: { type: 'integer', minimum: 0 },
			runningFeeds: { type: 'integer', minimum: 0 },
			deadFeeds: { type: 'integer', minimum: 0 },
			newArticles: { type: 'integer', minimum: 0 },
			articleRevision: { type: 'integer', minimum: 0 },
			jobId: { type: ['string', 'null'] },
			scope: {
				type: 'object',
				properties: {
					feedId: { type: 'string', format: 'uuid' },
					categoryId: { type: 'string', format: 'uuid' },
				},
			},
			items: {
				type: 'array',
				items: { $ref: '#/components/schemas/FeedRefreshItemStatus' },
			},
		},
	},
	FeedDiscoveryCandidate: {
		type: 'object',
		required: ['id', 'requestId', 'candidateUrl', 'normalizedCandidateUrl', 'status', 'expiresAt'],
		properties: {
			id: { type: 'string', format: 'uuid' },
			requestId: { type: 'string', format: 'uuid' },
			candidateUrl: { type: 'string', format: 'uri' },
			normalizedCandidateUrl: { type: 'string', format: 'uri' },
			title: { type: ['string', 'null'] },
			type: { type: 'string' },
			status: { type: 'string' },
			expiresAt: { type: 'string', format: 'date-time' },
		},
	},
} as const;

export const durableFeedPaths = {
	'/feeds/{feedId}/replacement/cancel': {
		post: {
			tags: ['Feeds'],
			security: bearerSecurity,
			parameters: [
				{
					in: 'path',
					name: 'feedId',
					required: true,
					schema: { type: 'string', format: 'uuid' },
				},
			],
			responses: { '200': json(apiDataRef('#/components/schemas/FeedWithCounts')) },
		},
	},
	'/feeds/discovery/{requestId}': {
		get: {
			tags: ['Feeds'],
			security: bearerSecurity,
			parameters: [
				{
					in: 'path',
					name: 'requestId',
					required: true,
					schema: { type: 'string', format: 'uuid' },
				},
			],
			responses: {
				'200': json({
					type: 'array',
					items: { $ref: '#/components/schemas/FeedDiscoveryCandidate' },
				}),
			},
		},
	},
	'/feeds/discovery/candidates/{candidateId}/select': {
		post: {
			tags: ['Feeds'],
			security: bearerSecurity,
			parameters: [
				{
					in: 'path',
					name: 'candidateId',
					required: true,
					schema: { type: 'string', format: 'uuid' },
				},
			],
			responses: { '202': json({ type: 'object' }) },
		},
	},
} as const;
