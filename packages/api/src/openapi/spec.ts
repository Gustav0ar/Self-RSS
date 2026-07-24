import { adminPaths, adminSchemas } from './admin.spec';
import { authPaths, authSchemas } from './auth.spec';
import { durableFeedPaths, durableFeedSchemas } from './durable-feeds.spec';
import { feedHistoryPaths } from './feed-history.spec';
import { apiDataArrayRef, apiDataRef, bearerSecurity, json, listResponse } from './helpers';
import { preferencesAndStatsSchemas } from './preferences-stats.spec';
import { realtimePaths, realtimeSchemas } from './realtime.spec';

export const openApiSpec = {
	openapi: '3.1.0',
	info: {
		title: 'SelfFeed API',
		version: '1.0.0',
		description: 'Stable HTTP API for the SelfFeed web client and future mobile clients.',
	},
	servers: [{ url: '/api/v1' }],
	components: {
		securitySchemes: {
			bearerAuth: {
				type: 'http',
				scheme: 'bearer',
				bearerFormat: 'JWT',
			},
		},
		schemas: {
			ApiError: {
				type: 'object',
				required: ['error'],
				properties: {
					error: {
						type: 'object',
						required: ['code', 'message'],
						properties: {
							code: { type: 'string' },
							message: { type: 'string' },
							details: {},
						},
					},
				},
			},
			User: {
				type: 'object',
				required: ['id', 'email', 'role', 'isActive', 'createdAt', 'updatedAt'],
				properties: {
					id: { type: 'string', format: 'uuid' },
					email: { type: 'string', format: 'email' },
					role: { type: 'string', enum: ['admin', 'user'] },
					isActive: { type: 'boolean' },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' },
				},
			},
			AccessToken: {
				type: 'object',
				required: ['accessToken'],
				properties: {
					accessToken: { type: 'string' },
				},
			},
			AuthResponse: {
				type: 'object',
				required: ['user', 'tokens'],
				properties: {
					user: { $ref: '#/components/schemas/User' },
					tokens: { $ref: '#/components/schemas/AccessToken' },
				},
			},
			RefreshResponse: {
				type: 'object',
				required: ['tokens'],
				properties: {
					tokens: { $ref: '#/components/schemas/AccessToken' },
				},
			},
			...authSchemas,
			...adminSchemas,
			...durableFeedSchemas,
			AppSettings: {
				type: 'object',
				required: ['registrationLocked'],
				properties: {
					registrationLocked: { type: 'boolean' },
				},
			},
			RegistrationStatus: {
				type: 'object',
				required: ['registrationEnabled'],
				properties: {
					registrationEnabled: { type: 'boolean' },
				},
			},
			Category: {
				type: 'object',
				required: [
					'id',
					'userId',
					'parentCategoryId',
					'name',
					'slug',
					'sortOrder',
					'createdAt',
					'updatedAt',
				],
				properties: {
					id: { type: 'string', format: 'uuid' },
					userId: { type: 'string', format: 'uuid' },
					parentCategoryId: { type: ['string', 'null'], format: 'uuid' },
					name: { type: 'string' },
					slug: { type: 'string' },
					sortOrder: { type: 'integer' },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' },
				},
			},
			Feed: {
				type: 'object',
				required: [
					'id',
					'userId',
					'categoryId',
					'title',
					'siteUrl',
					'feedUrl',
					'faviconUrl',
					'description',
					'pollingIntervalMinutes',
					'lastSyncedAt',
					'lastSyncError',
					'lastSyncErrorAt',
					'syncStatus',
					'createdAt',
					'updatedAt',
				],
				properties: {
					id: { type: 'string', format: 'uuid' },
					userId: { type: 'string', format: 'uuid' },
					categoryId: { type: 'string', format: 'uuid' },
					title: { type: 'string' },
					siteUrl: { type: ['string', 'null'] },
					feedUrl: { type: 'string', format: 'uri' },
					faviconUrl: { type: ['string', 'null'] },
					description: { type: ['string', 'null'] },
					pollingIntervalMinutes: { type: 'integer' },
					lastSyncedAt: { type: ['string', 'null'], format: 'date-time' },
					lastSyncError: { type: ['string', 'null'] },
					lastSyncErrorAt: { type: ['string', 'null'], format: 'date-time' },
					nextSyncAt: { type: 'string', format: 'date-time' },
					syncStatus: {
						type: 'string',
						enum: [
							'idle',
							'syncing',
							'error',
							'pending',
							'backoff',
							'paused',
							'discovery_required',
							'replacement_pending',
						],
					},
					lifecycleStatus: {
						type: 'string',
						enum: [
							'pending',
							'active',
							'backoff',
							'paused',
							'error',
							'discovery_required',
							'replacement_pending',
						],
					},
					sourceId: { type: ['string', 'null'], format: 'uuid' },
					pendingSourceId: { type: ['string', 'null'], format: 'uuid' },
					pendingFeedUrl: { type: ['string', 'null'], format: 'uri' },
					sourceState: { type: ['string', 'null'] },
					sourceErrorCode: { type: ['string', 'null'] },
					sourceErrorDetails: { type: ['string', 'null'] },
					lastFetchAt: { type: ['string', 'null'], format: 'date-time' },
					lastSuccessAt: { type: ['string', 'null'], format: 'date-time' },
					nextEligibleFetchAt: { type: ['string', 'null'], format: 'date-time' },
					replacementRequestedAt: { type: ['string', 'null'], format: 'date-time' },
					discovery: { $ref: '#/components/schemas/FeedDiscoveryPresentation' },
					createdAt: { type: 'string', format: 'date-time' },
					updatedAt: { type: 'string', format: 'date-time' },
				},
			},
			FeedWithCounts: {
				allOf: [
					{ $ref: '#/components/schemas/Feed' },
					{
						type: 'object',
						required: ['unreadCount'],
						properties: {
							unreadCount: { type: 'integer' },
						},
					},
				],
			},
			CategoryWithCounts: {
				allOf: [
					{ $ref: '#/components/schemas/Category' },
					{
						type: 'object',
						required: ['feedCount', 'unreadCount', 'feeds', 'children'],
						properties: {
							feedCount: { type: 'integer' },
							unreadCount: { type: 'integer' },
							feeds: {
								type: 'array',
								items: { $ref: '#/components/schemas/FeedWithCounts' },
							},
							children: {
								type: 'array',
								items: { $ref: '#/components/schemas/CategoryWithCounts' },
							},
						},
					},
				],
			},
			CategoryTreeResult: {
				type: 'object',
				required: ['categories', 'totalUnread'],
				properties: {
					categories: {
						type: 'array',
						items: { $ref: '#/components/schemas/CategoryWithCounts' },
					},
					totalUnread: { type: 'integer' },
				},
			},
			ReorderCategoriesResult: {
				type: 'object',
				required: ['updatedCount'],
				properties: {
					updatedCount: { type: 'integer' },
				},
			},
			ArticleListItem: {
				type: 'object',
				required: [
					'id',
					'feedId',
					'feedTitle',
					'canonicalUrl',
					'title',
					'isRead',
					'contentStatus',
					'contentVersion',
				],
				properties: {
					id: { type: 'string', format: 'uuid' },
					feedId: { type: 'string', format: 'uuid' },
					feedTitle: { type: 'string' },
					feedFaviconUrl: { type: ['string', 'null'] },
					canonicalUrl: { type: ['string', 'null'] },
					title: { type: 'string' },
					author: { type: ['string', 'null'] },
					excerpt: { type: ['string', 'null'] },
					heroImageUrl: { type: ['string', 'null'] },
					publishedAt: { type: ['string', 'null'], format: 'date-time' },
					displayedAt: { type: ['string', 'null'], format: 'date-time' },
					isRead: { type: 'boolean' },
					contentStatus: {
						type: 'string',
						enum: ['feed_ready', 'enrichment_pending', 'full_ready', 'failed'],
					},
					contentVersion: { type: 'integer', minimum: 1 },
				},
			},
			ArticleDetail: {
				type: 'object',
				required: [
					'id',
					'feedId',
					'guid',
					'title',
					'fetchedAt',
					'hash',
					'feedTitle',
					'media',
					'contentStatus',
					'contentVersion',
					'isRead',
					'isEnriched',
				],
				properties: {
					id: { type: 'string', format: 'uuid' },
					feedId: { type: 'string', format: 'uuid' },
					guid: { type: 'string' },
					title: { type: 'string' },
					canonicalUrl: { type: ['string', 'null'] },
					author: { type: ['string', 'null'] },
					excerpt: { type: ['string', 'null'] },
					contentHtml: { type: ['string', 'null'] },
					contentText: { type: ['string', 'null'] },
					heroImageUrl: { type: ['string', 'null'] },
					publishedAt: { type: ['string', 'null'], format: 'date-time' },
					fetchedAt: { type: 'string', format: 'date-time' },
					hash: { type: 'string' },
					feedTitle: { type: 'string' },
					feedFaviconUrl: { type: ['string', 'null'] },
					feedSiteUrl: { type: ['string', 'null'] },
					media: { type: 'array', items: { type: 'object' } },
					contentStatus: {
						type: 'string',
						enum: ['feed_ready', 'enrichment_pending', 'full_ready', 'failed'],
					},
					contentVersion: { type: 'integer', minimum: 1 },
					enrichmentQueuedAt: { type: ['string', 'null'], format: 'date-time' },
					enrichmentAttemptedAt: { type: ['string', 'null'], format: 'date-time' },
					enrichedAt: { type: ['string', 'null'], format: 'date-time' },
					enrichmentError: { type: ['string', 'null'] },
					isRead: { type: 'boolean' },
					isEnriched: { type: 'boolean' },
				},
			},
			ArticleReadStateChangedEvent: {
				type: 'object',
				required: [
					'type',
					'eventId',
					'articleId',
					'feedId',
					'isRead',
					'source',
					'clientId',
					'updatedAt',
				],
				properties: {
					type: { type: 'string', const: 'article.read_state_changed' },
					eventId: { type: 'string' },
					articleId: { type: 'string', format: 'uuid' },
					feedId: { type: 'string', format: 'uuid' },
					isRead: { type: 'boolean' },
					source: { type: 'string' },
					clientId: { type: ['string', 'null'] },
					updatedAt: { type: 'string', format: 'date-time' },
				},
			},
			ArticlesMarkedReadEvent: {
				type: 'object',
				required: ['type', 'eventId', 'feedIds', 'scope', 'markedCount', 'clientId', 'updatedAt'],
				properties: {
					type: { type: 'string', const: 'articles.marked_read' },
					eventId: { type: 'string' },
					feedIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
					scope: {
						type: 'object',
						properties: {
							feedId: { type: 'string', format: 'uuid' },
							categoryId: { type: 'string', format: 'uuid' },
						},
					},
					markedCount: { type: 'integer' },
					clientId: { type: ['string', 'null'] },
					updatedAt: { type: 'string', format: 'date-time' },
				},
			},
			ArticlesNewEvent: {
				type: 'object',
				required: ['type', 'eventId', 'feedId', 'articleIds', 'count', 'updatedAt'],
				properties: {
					type: { type: 'string', const: 'articles.new' },
					eventId: { type: 'string' },
					feedId: { type: 'string', format: 'uuid' },
					articleIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
					count: { type: 'integer' },
					updatedAt: { type: 'string', format: 'date-time' },
				},
			},
			ArticleUpdatedEvent: {
				type: 'object',
				required: [
					'type',
					'eventId',
					'articleId',
					'feedId',
					'contentStatus',
					'contentVersion',
					'updatedAt',
				],
				properties: {
					type: { type: 'string', const: 'article.updated' },
					eventId: { type: 'string' },
					articleId: { type: 'string', format: 'uuid' },
					feedId: { type: 'string', format: 'uuid' },
					contentStatus: {
						type: 'string',
						enum: ['feed_ready', 'enrichment_pending', 'full_ready', 'failed'],
					},
					contentVersion: { type: 'integer', minimum: 1 },
					updatedAt: { type: 'string', format: 'date-time' },
				},
			},
			...realtimeSchemas,
			MarkAllReadResult: {
				type: 'object',
				required: ['markedCount', 'feedIds'],
				properties: {
					markedCount: { type: 'integer' },
					feedIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
				},
			},
			...preferencesAndStatsSchemas,
			OpmlImportWarning: {
				type: 'object',
				required: ['code', 'message'],
				properties: {
					code: { type: 'string' },
					message: { type: 'string' },
					feedUrl: { type: 'string' },
					categoryPath: { type: 'array', items: { type: 'string' } },
				},
			},
			OpmlImportSummary: {
				type: 'object',
				required: [
					'createdCategories',
					'createdFeeds',
					'skippedDuplicates',
					'invalidEntries',
					'warnings',
				],
				properties: {
					createdCategories: { type: 'integer' },
					createdFeeds: { type: 'integer' },
					skippedDuplicates: { type: 'integer' },
					invalidEntries: { type: 'integer' },
					warnings: {
						type: 'array',
						items: { $ref: '#/components/schemas/OpmlImportWarning' },
					},
				},
			},
		},
	},
	paths: {
		...authPaths,
		...adminPaths,
		...durableFeedPaths,
		...feedHistoryPaths,
		'/categories': {
			get: {
				tags: ['Categories'],
				security: bearerSecurity,
				responses: { '200': json(apiDataRef('#/components/schemas/CategoryTreeResult')) },
			},
			post: {
				tags: ['Categories'],
				security: bearerSecurity,
				requestBody: json({
					type: 'object',
					required: ['name'],
					properties: {
						name: { type: 'string', minLength: 1, maxLength: 100 },
						parentCategoryId: { type: ['string', 'null'], format: 'uuid' },
						sortOrder: { type: 'integer', minimum: 0 },
					},
				}),
				responses: { '201': json(apiDataRef('#/components/schemas/Category')) },
			},
		},
		'/categories/reorder': {
			patch: {
				tags: ['Categories'],
				security: bearerSecurity,
				requestBody: json({
					type: 'object',
					required: ['updates'],
					properties: {
						updates: {
							type: 'array',
							minItems: 1,
							maxItems: 500,
							items: {
								type: 'object',
								required: ['id', 'sortOrder'],
								properties: {
									id: { type: 'string', format: 'uuid' },
									sortOrder: { type: 'integer', minimum: 0 },
								},
							},
						},
					},
				}),
				responses: { '200': json(apiDataRef('#/components/schemas/ReorderCategoriesResult')) },
			},
		},
		'/categories/{categoryId}': {
			patch: {
				tags: ['Categories'],
				security: bearerSecurity,
				parameters: [
					{ in: 'path', name: 'categoryId', required: true, schema: { type: 'string' } },
				],
				requestBody: json({
					type: 'object',
					properties: {
						name: { type: 'string', minLength: 1, maxLength: 100 },
						parentCategoryId: { type: ['string', 'null'], format: 'uuid' },
						sortOrder: { type: 'integer', minimum: 0 },
					},
				}),
				responses: { '200': json(apiDataRef('#/components/schemas/Category')) },
			},
			delete: {
				tags: ['Categories'],
				security: bearerSecurity,
				parameters: [
					{ in: 'path', name: 'categoryId', required: true, schema: { type: 'string' } },
				],
				responses: { '200': json({ type: 'object' }) },
			},
		},
		'/feeds': {
			get: {
				tags: ['Feeds'],
				security: bearerSecurity,
				responses: { '200': json(apiDataArrayRef('#/components/schemas/FeedWithCounts')) },
			},
			post: {
				tags: ['Feeds'],
				security: bearerSecurity,
				requestBody: json({
					type: 'object',
					required: ['categoryId', 'feedUrl'],
					properties: {
						categoryId: { type: 'string', format: 'uuid' },
						feedUrl: { type: 'string', format: 'uri', maxLength: 2048 },
						title: { type: 'string', minLength: 1, maxLength: 255 },
					},
				}),
				responses: { '201': json(apiDataRef('#/components/schemas/FeedWithCounts')) },
			},
		},
		'/feeds/import/opml': {
			post: {
				tags: ['Feeds'],
				security: bearerSecurity,
				requestBody: {
					required: true,
					content: {
						'multipart/form-data': {
							schema: {
								type: 'object',
								required: ['file'],
								properties: {
									file: { type: 'string', format: 'binary' },
								},
							},
						},
					},
				},
				responses: {
					'201': json(apiDataRef('#/components/schemas/OpmlImportSummary')),
					'400': json({ $ref: '#/components/schemas/ApiError' }),
				},
			},
		},
		'/feeds/export/opml': {
			get: {
				tags: ['Feeds'],
				security: bearerSecurity,
				responses: {
					'200': {
						description: 'OPML subscription export',
						content: {
							'application/xml': { schema: { type: 'string' } },
						},
					},
				},
			},
		},
		'/feeds/{feedId}': {
			patch: {
				tags: ['Feeds'],
				description:
					'Non-URL edits apply immediately. In v2 a URL change validates asynchronously while the old source remains usable; successful validation atomically removes old articles/read rows and activates the replacement.',
				security: bearerSecurity,
				parameters: [{ in: 'path', name: 'feedId', required: true, schema: { type: 'string' } }],
				requestBody: json({
					type: 'object',
					properties: {
						categoryId: { type: 'string', format: 'uuid' },
						feedUrl: { type: 'string', format: 'uri', maxLength: 2048 },
						title: { type: 'string', minLength: 1, maxLength: 255 },
						pollingIntervalMinutes: { type: 'integer', minimum: 5, maximum: 1440 },
					},
				}),
				responses: { '200': json(apiDataRef('#/components/schemas/FeedWithCounts')) },
			},
			delete: {
				tags: ['Feeds'],
				security: bearerSecurity,
				parameters: [{ in: 'path', name: 'feedId', required: true, schema: { type: 'string' } }],
				responses: { '200': json({ type: 'object' }) },
			},
		},
		'/feeds/sync': {
			post: {
				tags: ['Feeds'],
				security: bearerSecurity,
				parameters: [
					{ in: 'header', name: 'Idempotency-Key', schema: { type: 'string', maxLength: 255 } },
					{ in: 'query', name: 'feedId', schema: { type: 'string', format: 'uuid' } },
					{ in: 'query', name: 'categoryId', schema: { type: 'string', format: 'uuid' } },
				],
				responses: { '202': json({ type: 'object' }) },
			},
		},
		'/feeds/sync/status': {
			get: {
				tags: ['Feeds'],
				security: bearerSecurity,
				parameters: [
					{ in: 'query', name: 'requestId', schema: { type: 'string', format: 'uuid' } },
				],
				responses: {
					'200': json(apiDataRef('#/components/schemas/FeedSyncAllStatus')),
				},
			},
		},
		'/feeds/{feedId}/sync': {
			post: {
				tags: ['Feeds'],
				security: bearerSecurity,
				parameters: [{ in: 'path', name: 'feedId', required: true, schema: { type: 'string' } }],
				responses: {
					'200': json({ type: 'object' }),
					'202': json({ type: 'object' }),
				},
			},
		},
		'/articles': {
			get: {
				tags: ['Articles'],
				security: bearerSecurity,
				parameters: [
					{
						name: 'feedId',
						in: 'query',
						required: false,
						schema: { type: 'string', format: 'uuid' },
					},
					{
						name: 'categoryId',
						in: 'query',
						required: false,
						schema: { type: 'string', format: 'uuid' },
					},
					{
						name: 'unreadOnly',
						in: 'query',
						required: false,
						schema: { type: 'boolean' },
					},
					{
						name: 'sort',
						in: 'query',
						required: false,
						schema: { type: 'string', enum: ['latest', 'oldest'], default: 'latest' },
					},
					{
						name: 'cursor',
						in: 'query',
						required: false,
						schema: { type: 'string' },
					},
					{
						name: 'limit',
						in: 'query',
						required: false,
						schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
					},
				],
				responses: {
					'200': json(listResponse('#/components/schemas/ArticleListItem')),
				},
			},
		},
		'/articles/detail': {
			get: {
				tags: ['Articles'],
				security: bearerSecurity,
				parameters: [
					{
						in: 'query',
						name: 'id',
						required: true,
						schema: { type: 'string', format: 'uuid' },
					},
				],
				responses: { '200': json(apiDataRef('#/components/schemas/ArticleDetail')) },
			},
		},
		'/articles/{articleId}/enrich': {
			post: {
				tags: ['Articles'],
				security: bearerSecurity,
				parameters: [{ in: 'path', name: 'articleId', required: true, schema: { type: 'string' } }],
				responses: { '200': json({ type: 'object' }) },
			},
		},
		'/articles/{articleId}/read': {
			patch: {
				tags: ['Articles'],
				security: bearerSecurity,
				parameters: [{ in: 'path', name: 'articleId', required: true, schema: { type: 'string' } }],
				requestBody: json({ type: 'object' }),
				responses: { '200': json({ type: 'object' }) },
			},
		},
		'/articles/mark-all-read': {
			patch: {
				tags: ['Articles'],
				security: bearerSecurity,
				requestBody: json({
					oneOf: [
						{ type: 'object', additionalProperties: false },
						{
							type: 'object',
							additionalProperties: false,
							required: ['feedId'],
							properties: { feedId: { type: 'string', format: 'uuid' } },
						},
						{
							type: 'object',
							additionalProperties: false,
							required: ['categoryId'],
							properties: { categoryId: { type: 'string', format: 'uuid' } },
						},
					],
				}),
				responses: { '200': json(apiDataRef('#/components/schemas/MarkAllReadResult')) },
			},
		},
		...realtimePaths,
		'/search': {
			get: {
				tags: ['Search'],
				security: bearerSecurity,
				parameters: [
					{
						name: 'q',
						in: 'query',
						required: true,
						schema: { type: 'string', minLength: 2, maxLength: 500 },
					},
					{
						name: 'categoryId',
						in: 'query',
						required: false,
						schema: { type: 'string', format: 'uuid' },
					},
					{
						name: 'cursor',
						in: 'query',
						required: false,
						schema: { type: 'string' },
					},
					{
						name: 'limit',
						in: 'query',
						required: false,
						schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
					},
				],
				responses: {
					'200': json(listResponse('#/components/schemas/ArticleListItem')),
				},
			},
		},
		'/preferences': {
			get: {
				tags: ['Preferences'],
				security: bearerSecurity,
				responses: { '200': json(apiDataRef('#/components/schemas/Preferences')) },
			},
			patch: {
				tags: ['Preferences'],
				security: bearerSecurity,
				requestBody: json({ $ref: '#/components/schemas/Preferences' }),
				responses: { '200': json(apiDataRef('#/components/schemas/Preferences')) },
			},
		},
		'/stats': {
			get: {
				tags: ['Stats'],
				security: bearerSecurity,
				responses: { '200': json(apiDataRef('#/components/schemas/Stats')) },
			},
		},
	},
} as const;
