import { ARTICLE_STATE_LOOKUP_LIMIT } from '@self-feed/shared';
import { apiDataRef, bearerSecurity, json } from './helpers';

export const articleStateSchemas = {
	ArticleStateSnapshot: {
		type: 'object',
		required: ['id', 'isRead', 'isSaved', 'readRevision', 'savedRevision'],
		properties: {
			id: { type: 'string', format: 'uuid' },
			isRead: { type: 'boolean' },
			isSaved: { type: 'boolean' },
			readRevision: { type: 'integer', minimum: 0 },
			savedRevision: { type: 'integer', minimum: 0 },
		},
	},
	ArticleStateLookupResponse: {
		type: 'object',
		required: ['states', 'missingIds'],
		properties: {
			states: { type: 'array', items: { $ref: '#/components/schemas/ArticleStateSnapshot' } },
			missingIds: {
				type: 'array',
				items: { type: 'string', format: 'uuid' },
				description:
					'Missing and unowned IDs are indistinguishable. Absence does not imply a false state.',
			},
		},
	},
	ArticleStateMutation: {
		type: 'object',
		required: ['success', 'applied', 'conflict', 'duplicate', 'revision'],
		properties: {
			success: { type: 'boolean', const: true },
			applied: { type: 'boolean' },
			conflict: { type: 'boolean' },
			duplicate: { type: 'boolean' },
			read: { type: 'boolean' },
			saved: { type: 'boolean' },
			revision: { type: 'integer', minimum: 0 },
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
			revision: { type: 'integer', minimum: 0 },
			source: { type: 'string' },
			clientId: { type: ['string', 'null'] },
			updatedAt: { type: 'string', format: 'date-time' },
		},
	},
	ArticleSavedStateChangedEvent: {
		type: 'object',
		required: ['type', 'eventId', 'articleId', 'feedId', 'isSaved', 'clientId', 'updatedAt'],
		properties: {
			type: { type: 'string', const: 'article.saved_state_changed' },
			eventId: { type: 'string' },
			articleId: { type: 'string', format: 'uuid' },
			feedId: { type: 'string', format: 'uuid' },
			isSaved: { type: 'boolean' },
			revision: { type: 'integer', minimum: 0 },
			clientId: { type: ['string', 'null'] },
			updatedAt: { type: 'string', format: 'date-time' },
		},
	},
} as const;

export const articleStatePaths = {
	'/articles/states': {
		post: {
			tags: ['Articles'],
			security: bearerSecurity,
			summary: 'Read current flags and revisions for a bounded set of owned articles',
			requestBody: {
				required: true,
				...json({
					type: 'object',
					required: ['articleIds'],
					properties: {
						articleIds: {
							type: 'array',
							minItems: 1,
							maxItems: ARTICLE_STATE_LOOKUP_LIMIT,
							items: { type: 'string', format: 'uuid' },
						},
					},
				}),
			},
			responses: {
				'200': {
					...json(apiDataRef('#/components/schemas/ArticleStateLookupResponse')),
					headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
				},
				'400': json({ $ref: '#/components/schemas/ApiError' }),
				'401': json({ $ref: '#/components/schemas/ApiError' }),
				'429': json({ $ref: '#/components/schemas/ApiError' }),
			},
		},
	},
} as const;
