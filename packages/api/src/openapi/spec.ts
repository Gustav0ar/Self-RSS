const bearerSecurity = [{ bearerAuth: [] }];

function json(content: Record<string, unknown>) {
	return {
		content: {
			'application/json': {
				schema: content,
			},
		},
	};
}

function apiDataRef(ref: string) {
	return {
		type: 'object',
		required: ['data'],
		properties: {
			data: { $ref: ref },
		},
	};
}

function listResponse(ref: string) {
	return {
		type: 'object',
		required: ['data', 'cursor', 'hasMore'],
		properties: {
			data: { type: 'array', items: { $ref: ref } },
			cursor: { type: ['string', 'null'] },
			hasMore: { type: 'boolean' },
		},
	};
}

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
		},
	},
	paths: {
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
		'/categories': {
			get: {
				tags: ['Categories'],
				security: bearerSecurity,
				responses: { '200': json({ type: 'object' }) },
			},
			post: {
				tags: ['Categories'],
				security: bearerSecurity,
				requestBody: json({ type: 'object' }),
				responses: { '201': json({ type: 'object' }) },
			},
		},
		'/categories/{categoryId}': {
			patch: {
				tags: ['Categories'],
				security: bearerSecurity,
				parameters: [
					{ in: 'path', name: 'categoryId', required: true, schema: { type: 'string' } },
				],
				requestBody: json({ type: 'object' }),
				responses: { '200': json({ type: 'object' }) },
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
				responses: { '200': json({ type: 'object' }) },
			},
			post: {
				tags: ['Feeds'],
				security: bearerSecurity,
				requestBody: json({ type: 'object' }),
				responses: { '201': json({ type: 'object' }) },
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
				requestBody: json({ type: 'object' }),
				responses: { '200': json({ type: 'object' }) },
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
				requestBody: json({ type: 'object' }),
				responses: { '200': json({ type: 'object' }) },
			},
		},
		'/search': {
			get: {
				tags: ['Search'],
				security: bearerSecurity,
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
