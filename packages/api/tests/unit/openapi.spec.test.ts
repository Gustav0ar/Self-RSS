import { describe, expect, it } from 'vitest';
import { openApiSpec } from '../../src/openapi/spec.js';

function queryParameterNames(path: string, method: 'get' | 'post' | 'patch' | 'delete') {
	type Operation = {
		readonly parameters?: readonly { readonly name: string; readonly in: string }[];
	};
	const operation = (
		openApiSpec.paths as unknown as Record<string, Readonly<Record<string, Operation>>>
	)[path]?.[method];
	return (operation?.parameters ?? [])
		.filter((parameter) => parameter.in === 'query')
		.map((parameter) => parameter.name);
}

describe('openApiSpec route drift guards', () => {
	it('documents the current admin settings route instead of the removed registration-lock route', () => {
		expect(openApiSpec.paths).toHaveProperty('/admin/settings');
		expect(openApiSpec.paths).not.toHaveProperty('/admin/registration-lock');
	});

	it('documents cursor-based article list pagination and filters', () => {
		expect(queryParameterNames('/articles', 'get')).toEqual(
			expect.arrayContaining(['feedId', 'categoryId', 'unreadOnly', 'sort', 'cursor', 'limit']),
		);
		expect(queryParameterNames('/articles', 'get')).not.toContain('offset');
	});

	it('documents cursor-based search pagination', () => {
		expect(queryParameterNames('/search', 'get')).toEqual(
			expect.arrayContaining(['q', 'categoryId', 'cursor', 'limit']),
		);
		expect(queryParameterNames('/search', 'get')).not.toContain('offset');
	});

	it('documents bulk category reorder and mark-all-read response contracts', () => {
		expect(openApiSpec.paths).toHaveProperty('/categories/reorder');
		expect(openApiSpec.components.schemas).toHaveProperty('ReorderCategoriesResult');
		expect(openApiSpec.components.schemas).toHaveProperty('MarkAllReadResult');
	});
});
