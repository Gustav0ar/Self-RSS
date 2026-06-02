import { z } from 'zod';

export const createCategorySchema = z.object({
	name: z.string().min(1).max(100),
	parentCategoryId: z.string().uuid().nullable().optional(),
	sortOrder: z.number().int().min(0).optional(),
});

export const updateCategorySchema = z.object({
	name: z.string().min(1).max(100).optional(),
	parentCategoryId: z.string().uuid().nullable().optional(),
	sortOrder: z.number().int().min(0).optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
