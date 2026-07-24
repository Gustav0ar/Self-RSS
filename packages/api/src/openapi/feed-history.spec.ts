import { bearerSecurity, json } from './helpers';

export const feedHistoryPaths = {
	'/feeds/{feedId}/sync-runs': {
		get: {
			tags: ['Feeds'],
			security: bearerSecurity,
			parameters: [
				{
					in: 'path',
					name: 'feedId',
					required: true,
					schema: { type: 'string', format: 'uuid' },
				},
				{
					in: 'query',
					name: 'limit',
					schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
				},
				{ in: 'query', name: 'cursor', schema: { type: 'string', pattern: '^\\d+$' } },
			],
			responses: {
				'200': json({
					type: 'object',
					required: ['data'],
					properties: {
						data: {
							type: 'object',
							required: ['runs', 'cursor', 'hasMore'],
							properties: {
								runs: {
									type: 'array',
									items: { $ref: '#/components/schemas/SyncRun' },
								},
								cursor: { type: ['string', 'null'] },
								hasMore: { type: 'boolean' },
							},
						},
					},
				}),
			},
		},
	},
} as const;
