import { z } from 'zod';

export const searchQuerySchema = z.object({
	q: z.string().min(1).max(500),
	categoryId: z.string().uuid().optional(),
	cursor: z.string().optional(),
	limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional().default(20),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
