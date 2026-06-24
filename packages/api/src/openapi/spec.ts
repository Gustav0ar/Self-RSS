import { authPaths, authSchemas } from './auth.spec';
import { apiDataArrayRef, apiDataRef, bearerSecurity, json, listResponse } from './helpers';

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
					syncStatus: { type: 'string', enum: ['idle', 'syncing', 'error'] },
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
				required: ['id', 'feedId', 'feedTitle', 'title', 'isRead'],
				properties: {
					id: { type: 'string', format: 'uuid' },
					feedId: { type: 'string', format: 'uuid' },
					feedTitle: { type: 'string' },
					feedFaviconUrl: { type: ['string', 'null'] },
					title: { type: 'string' },
					author: { type: ['string', 'null'] },
					excerpt: { type: ['string', 'null'] },
					heroImageUrl: { type: ['string', 'null'] },
					publishedAt: { type: ['string', 'null'], format: 'date-time' },
					isRead: { type: 'boolean' },
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
			ReadStateSyncEvent: {
				oneOf: [
					{ $ref: '#/components/schemas/ArticleReadStateChangedEvent' },
					{ $ref: '#/components/schemas/ArticlesMarkedReadEvent' },
				],
			},
			MarkAllReadResult: {
				type: 'object',
				required: ['markedCount', 'feedIds'],
				properties: {
					markedCount: { type: 'integer' },
					feedIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
				},
			},
			Preferences: {
				type: 'object',
				properties: {
					theme: { type: 'string' },
					fontFamily: { type: 'string' },
					textSize: { type: 'integer' },
					density: { type: 'string' },
					defaultSort: { type: 'string' },
					hideRead: { type: 'boolean' },
					keyboardShortcutsEnabled: { type: 'boolean' },
					autoMarkReadMode: { type: 'string' },
					accentColor: { type: 'string' },
				},
			},
			Stats: {
				type: 'object',
				properties: {
					totalUnread: { type: 'integer' },
					totalRead: { type: 'integer' },
					totalFeeds: { type: 'integer' },
					totalCategories: { type: 'integer' },
					recentSyncRuns: { type: 'array', items: { type: 'object' } },
					dailyMetrics: { type: 'array', items: { type: 'object' } },
				},
			},
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
			FeedSyncAllStatus: {
				type: 'object',
				required: ['queued', 'running', 'active', 'stale', 'queuedAt', 'startedAt', 'heartbeatAt'],
				properties: {
					queued: { type: 'boolean' },
					running: { type: 'boolean' },
					active: { type: 'boolean' },
					stale: { type: 'boolean' },
					queuedAt: { type: 'string', format: 'date-time', nullable: true },
					startedAt: { type: 'string', format: 'date-time', nullable: true },
					heartbeatAt: { type: 'string', format: 'date-time', nullable: true },
				},
			},
		},
	},
	paths: {
		...authPaths,
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
				responses: { '201': json(apiDataRef('#/components/schemas/Feed')) },
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
		'/feeds/{feedId}': {
			patch: {
				tags: ['Feeds'],
				security: bearerSecurity,
				parameters: [{ in: 'path', name: 'feedId', required: true, schema: { type: 'string' } }],
				requestBody: json({
					type: 'object',
					properties: {
						categoryId: { type: 'string', format: 'uuid' },
						title: { type: 'string', minLength: 1, maxLength: 255 },
						pollingIntervalMinutes: { type: 'integer', minimum: 5, maximum: 1440 },
					},
				}),
				responses: { '200': json(apiDataRef('#/components/schemas/Feed')) },
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
				responses: { '202': json({ type: 'object' }) },
			},
		},
		'/feeds/sync/status': {
			get: {
				tags: ['Feeds'],
				security: bearerSecurity,
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
				responses: { '200': json({ type: 'object' }) },
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
		'/articles/{articleId}': {
			get: {
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
		'/events/read-state': {
			get: {
				tags: ['Events'],
				security: bearerSecurity,
				description:
					'Server-sent event stream for read/unread changes. Events use event name "read-state" with a ReadStateSyncEvent JSON payload.',
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
		'/admin/settings': {
			get: {
				tags: ['Admin'],
				security: bearerSecurity,
				responses: { '200': json(apiDataRef('#/components/schemas/AppSettings')) },
			},
			patch: {
				tags: ['Admin'],
				security: bearerSecurity,
				requestBody: json({ $ref: '#/components/schemas/AppSettings' }),
				responses: { '200': json(apiDataRef('#/components/schemas/AppSettings')) },
			},
		},
		'/admin/users': {
			post: {
				tags: ['Admin'],
				security: bearerSecurity,
				requestBody: json({
					type: 'object',
					required: ['email', 'password'],
					properties: {
						email: { type: 'string', format: 'email' },
						password: { type: 'string', minLength: 8 },
						role: { type: 'string', enum: ['admin', 'user'] },
					},
				}),
				responses: { '201': json(apiDataRef('#/components/schemas/User')) },
			},
		},
	},
} as const;
