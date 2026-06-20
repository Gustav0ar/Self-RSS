import { z } from 'zod';

export const markReadSchema = z.object({
	read: z.boolean(),
	source: z.enum(['manual', 'auto_navigate', 'auto_open']).optional().default('manual'),
});

export const markAllReadSchema = z
	.object({
		categoryId: z.string().uuid().optional(),
		feedId: z.string().uuid().optional(),
	})
	.refine((value) => !(value.categoryId && value.feedId), {
		message: 'Specify either categoryId or feedId, not both',
		path: ['feedId'],
	});

export const articleQuerySchema = z.object({
	categoryId: z.string().uuid().optional(),
	feedId: z.string().uuid().optional(),
	unreadOnly: z
		.string()
		.transform((v) => v === 'true')
		.optional(),
	sort: z.enum(['latest', 'oldest']).optional().default('latest'),
	cursor: z.string().optional(),
	limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional().default(20),
});

export type MarkReadInput = z.infer<typeof markReadSchema>;
export type MarkAllReadInput = z.infer<typeof markAllReadSchema>;
export type ArticleQueryInput = z.infer<typeof articleQuerySchema>;
