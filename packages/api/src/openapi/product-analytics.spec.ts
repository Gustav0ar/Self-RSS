import { apiDataRef, bearerSecurity, json } from './helpers';

export const productAnalyticsSchemas = {
	ProductAnalyticsEvent: {
		type: 'object',
		required: ['id', 'type', 'occurredOn'],
		properties: {
			id: { type: 'string', format: 'uuid' },
			type: {
				type: 'string',
				enum: ['app_opened', 'offline_restore', 'article_completed'],
			},
			occurredOn: { type: 'string', format: 'date' },
		},
	},
	RecordProductAnalyticsEventsResponse: {
		type: 'object',
		required: ['accepted'],
		properties: { accepted: { type: 'integer', minimum: 0 } },
	},
	ProductAnalyticsDaily: {
		type: 'object',
		required: [
			'date',
			'activeUsers',
			'articlesSaved',
			'offlineRestores',
			'articlesCompleted',
			'feedFailures',
		],
		properties: {
			date: { type: 'string', format: 'date' },
			activeUsers: { type: 'integer', minimum: 0 },
			articlesSaved: { type: 'integer', minimum: 0 },
			offlineRestores: { type: 'integer', minimum: 0 },
			articlesCompleted: { type: 'integer', minimum: 0 },
			feedFailures: { type: 'integer', minimum: 0 },
		},
	},
	ProductAnalyticsTotals: {
		type: 'object',
		required: [
			'activeUsers',
			'articlesSaved',
			'offlineRestores',
			'articlesCompleted',
			'feedFailures',
		],
		properties: {
			activeUsers: { type: 'integer', minimum: 0 },
			articlesSaved: { type: 'integer', minimum: 0 },
			offlineRestores: { type: 'integer', minimum: 0 },
			articlesCompleted: { type: 'integer', minimum: 0 },
			feedFailures: { type: 'integer', minimum: 0 },
		},
	},
	ProductRetentionMetric: {
		type: 'object',
		required: ['windowDays', 'eligibleUsers', 'returningUsers', 'rate'],
		properties: {
			windowDays: { type: 'integer', enum: [7, 30] },
			eligibleUsers: { type: 'integer', minimum: 0 },
			returningUsers: { type: 'integer', minimum: 0 },
			rate: { type: ['number', 'null'], minimum: 0, maximum: 1 },
		},
	},
	ProductAnalyticsReport: {
		type: 'object',
		required: ['periodDays', 'throughDate', 'totals', 'daily', 'retention'],
		properties: {
			periodDays: { type: 'integer', enum: [30] },
			throughDate: { type: 'string', format: 'date' },
			totals: { $ref: '#/components/schemas/ProductAnalyticsTotals' },
			daily: {
				type: 'array',
				items: { $ref: '#/components/schemas/ProductAnalyticsDaily' },
			},
			retention: {
				type: 'object',
				required: ['sevenDay', 'thirtyDay'],
				properties: {
					sevenDay: { $ref: '#/components/schemas/ProductRetentionMetric' },
					thirtyDay: { $ref: '#/components/schemas/ProductRetentionMetric' },
				},
			},
		},
	},
} as const;

export const productAnalyticsPaths = {
	'/analytics/events': {
		post: {
			tags: ['Analytics'],
			security: bearerSecurity,
			requestBody: json({
				type: 'object',
				required: ['events'],
				properties: {
					events: {
						type: 'array',
						minItems: 1,
						maxItems: 50,
						items: { $ref: '#/components/schemas/ProductAnalyticsEvent' },
					},
				},
			}),
			responses: {
				'200': json(apiDataRef('#/components/schemas/RecordProductAnalyticsEventsResponse')),
			},
		},
	},
	'/admin/product-analytics': {
		get: {
			tags: ['Admin', 'Analytics'],
			security: bearerSecurity,
			responses: {
				'200': json(apiDataRef('#/components/schemas/ProductAnalyticsReport')),
			},
		},
	},
} as const;
