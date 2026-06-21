export const bearerSecurity = [{ bearerAuth: [] }];

export function json(content: Record<string, unknown>) {
	return {
		content: {
			'application/json': {
				schema: content,
			},
		},
	};
}

export function apiDataRef(ref: string) {
	return {
		type: 'object',
		required: ['data'],
		properties: {
			data: { $ref: ref },
		},
	};
}

export function apiDataArrayRef(ref: string) {
	return {
		type: 'object',
		required: ['data'],
		properties: {
			data: { type: 'array', items: { $ref: ref } },
		},
	};
}

export function listResponse(ref: string) {
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
