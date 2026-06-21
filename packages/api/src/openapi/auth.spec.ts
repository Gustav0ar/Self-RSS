import { apiDataRef, bearerSecurity, json } from './helpers';

export const authSchemas = {
	AuthSession: {
		type: 'object',
		required: ['id', 'deviceName', 'createdAt', 'lastSeenAt', 'current'],
		properties: {
			id: { type: 'string', format: 'uuid' },
			deviceName: { type: 'string' },
			clientId: { type: ['string', 'null'] },
			ipAddress: { type: ['string', 'null'] },
			userAgent: { type: ['string', 'null'] },
			createdAt: { type: 'string', format: 'date-time' },
			lastSeenAt: { type: 'string', format: 'date-time' },
			current: { type: 'boolean' },
		},
	},
	AuthSessionsResponse: {
		type: 'object',
		required: ['sessions'],
		properties: {
			sessions: {
				type: 'array',
				items: { $ref: '#/components/schemas/AuthSession' },
			},
		},
	},
};

export const authPaths = {
	'/auth/registration-status': {
		get: {
			tags: ['Auth'],
			responses: {
				'200': json(apiDataRef('#/components/schemas/RegistrationStatus')),
			},
		},
	},
	'/auth/register': {
		post: {
			tags: ['Auth'],
			requestBody: json({
				type: 'object',
				required: ['email', 'password'],
				properties: {
					email: { type: 'string', format: 'email' },
					password: { type: 'string', minLength: 8 },
				},
			}),
			responses: {
				'201': json(apiDataRef('#/components/schemas/AuthResponse')),
				'400': json({ $ref: '#/components/schemas/ApiError' }),
			},
		},
	},
	'/auth/login': {
		post: {
			tags: ['Auth'],
			requestBody: json({
				type: 'object',
				required: ['email', 'password'],
				properties: {
					email: { type: 'string', format: 'email' },
					password: { type: 'string' },
				},
			}),
			responses: {
				'200': json(apiDataRef('#/components/schemas/AuthResponse')),
				'401': json({ $ref: '#/components/schemas/ApiError' }),
			},
		},
	},
	'/auth/logout': {
		post: {
			tags: ['Auth'],
			responses: {
				'200': json({
					type: 'object',
					properties: { data: { type: 'object', properties: { success: { type: 'boolean' } } } },
				}),
			},
		},
	},
	'/auth/refresh': {
		post: {
			tags: ['Auth'],
			responses: {
				'200': json(apiDataRef('#/components/schemas/RefreshResponse')),
				'401': json({ $ref: '#/components/schemas/ApiError' }),
			},
		},
	},
	'/auth/me': {
		get: {
			tags: ['Auth'],
			security: bearerSecurity,
			responses: {
				'200': json(apiDataRef('#/components/schemas/User')),
			},
		},
	},
	'/auth/sessions': {
		get: {
			tags: ['Auth'],
			security: bearerSecurity,
			responses: {
				'200': json(apiDataRef('#/components/schemas/AuthSessionsResponse')),
			},
		},
	},
	'/auth/sessions/{sessionId}': {
		delete: {
			tags: ['Auth'],
			security: bearerSecurity,
			parameters: [
				{
					name: 'sessionId',
					in: 'path',
					required: true,
					schema: { type: 'string', format: 'uuid' },
				},
			],
			responses: {
				'200': json({
					type: 'object',
					properties: { data: { type: 'object', properties: { success: { type: 'boolean' } } } },
				}),
				'404': json({ $ref: '#/components/schemas/ApiError' }),
			},
		},
	},
};
