import { apiDataRef, bearerSecurity, json } from './helpers';

export const adminSchemas = {
	AdminUsersResponse: {
		type: 'object',
		required: ['users', 'cursor', 'hasMore'],
		properties: {
			users: { type: 'array', items: { $ref: '#/components/schemas/User' } },
			cursor: { type: ['string', 'null'] },
			hasMore: { type: 'boolean' },
		},
	},
} as const;

export const adminPaths = {
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
		get: {
			tags: ['Admin'],
			security: bearerSecurity,
			parameters: [
				{
					in: 'query',
					name: 'limit',
					schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
				},
				{ in: 'query', name: 'cursor', schema: { type: 'string', pattern: '^\\d+$' } },
			],
			responses: {
				'200': json(apiDataRef('#/components/schemas/AdminUsersResponse')),
			},
		},
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
	'/admin/users/{userId}': {
		patch: {
			tags: ['Admin'],
			security: bearerSecurity,
			parameters: [
				{
					in: 'path',
					name: 'userId',
					required: true,
					schema: { type: 'string', format: 'uuid' },
				},
			],
			requestBody: json({
				type: 'object',
				minProperties: 1,
				properties: {
					role: { type: 'string', enum: ['admin', 'user'] },
					isActive: { type: 'boolean' },
				},
			}),
			responses: { '200': json(apiDataRef('#/components/schemas/User')) },
		},
	},
	'/admin/users/{userId}/reset-password': {
		post: {
			tags: ['Admin'],
			security: bearerSecurity,
			parameters: [
				{
					in: 'path',
					name: 'userId',
					required: true,
					schema: { type: 'string', format: 'uuid' },
				},
			],
			requestBody: json({
				type: 'object',
				required: ['password'],
				properties: { password: { type: 'string', minLength: 8, maxLength: 128 } },
			}),
			responses: { '200': json(apiDataRef('#/components/schemas/User')) },
		},
	},
} as const;
