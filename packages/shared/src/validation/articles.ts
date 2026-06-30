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

const readStateEventMetadataSchema = z.object({
	eventId: z.string().min(1),
	clientId: z.string().min(1).nullable(),
	updatedAt: z.string().min(1),
});

export const articleReadStateChangedEventSchema = readStateEventMetadataSchema.extend({
	type: z.literal('article.read_state_changed'),
	articleId: z.string().min(1),
	feedId: z.string().min(1),
	isRead: z.boolean(),
	source: z.string().min(1),
});

export const articlesMarkedReadEventSchema = readStateEventMetadataSchema.extend({
	type: z.literal('articles.marked_read'),
	feedIds: z.array(z.string().min(1)),
	scope: z.object({
		categoryId: z.string().min(1).optional(),
		feedId: z.string().min(1).optional(),
	}),
	markedCount: z.number().int().nonnegative(),
});

export const articlesNewEventSchema = z.object({
	type: z.literal('articles.new'),
	eventId: z.string().min(1),
	feedId: z.string().min(1),
	articleIds: z.array(z.string().min(1)),
	count: z.number().int().nonnegative(),
	updatedAt: z.string().min(1),
});

export const readStateSyncEventSchema = z.discriminatedUnion('type', [
	articleReadStateChangedEventSchema,
	articlesMarkedReadEventSchema,
	articlesNewEventSchema,
]);

export type MarkReadInput = z.infer<typeof markReadSchema>;
export type MarkAllReadInput = z.infer<typeof markAllReadSchema>;
export type ArticleQueryInput = z.infer<typeof articleQuerySchema>;
export type ReadStateSyncEventInput = z.infer<typeof readStateSyncEventSchema>;
