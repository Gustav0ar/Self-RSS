import { createCategorySchema, updateCategorySchema } from '@self-feed/shared';
import { Hono } from 'hono';
import type { CategoryService } from '../services/category.service.js';
import { parseBody, parseUuidParam } from '../utils/validation.js';

export function createCategoryRoutes(categoryService: CategoryService) {
	const routes = new Hono();

	routes.get('/', async (c) => {
		const userId = c.get('userId');
		const result = await categoryService.getTree(userId);
		return c.json({ data: result });
	});

	routes.post('/', async (c) => {
		const userId = c.get('userId');
		const body = await parseBody(c, createCategorySchema);
		const cat = await categoryService.create(userId, body);
		return c.json(
			{
				data: {
					...cat,
					createdAt: cat.createdAt.toISOString(),
					updatedAt: cat.updatedAt.toISOString(),
				},
			},
			201,
		);
	});

	routes.patch('/:categoryId', async (c) => {
		const userId = c.get('userId');
		const categoryId = parseUuidParam(c, 'categoryId');
		const body = await parseBody(c, updateCategorySchema);
		const cat = await categoryService.update(userId, categoryId, body);
		return c.json({ data: cat });
	});

	routes.delete('/:categoryId', async (c) => {
		const userId = c.get('userId');
		const categoryId = parseUuidParam(c, 'categoryId');
		await categoryService.delete(userId, categoryId);
		return c.json({ data: { success: true } });
	});

	return routes;
}
