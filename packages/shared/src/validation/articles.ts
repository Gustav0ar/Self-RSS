import { z } from 'zod';

export const markReadSchema = z.object({
	read: z.boolean(),
	source: z.enum(['manual', 'auto_navigate', 'auto_open']).optional().default('manual'),
});

export const saveArticleSchema = z.object({
	saved: z.boolean(),
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
	savedOnly: z
		.string()
		.transform((v) => v === 'true')
		.optional(),
	sort: z.enum(['latest', 'oldest']).optional().default('latest'),
	cursor: z.string().optional(),
	limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).optional().default(20),
});

export const articleDetailQuerySchema = z.object({
	id: z.string().uuid(),
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

export const articleUpdatedEventSchema = z.object({
	type: z.literal('article.updated'),
	eventId: z.string().min(1),
	articleId: z.string().min(1),
	feedId: z.string().min(1),
	contentStatus: z.enum(['feed_ready', 'enrichment_pending', 'full_ready', 'failed']),
	contentVersion: z.number().int().positive(),
	updatedAt: z.string().min(1),
});

const feedSyncScopeSchema = z.object({
	categoryId: z.string().min(1).optional(),
	feedId: z.string().min(1).optional(),
});

export const feedSyncProgressEventSchema = z.object({
	type: z.literal('feed.sync.progress'),
	eventId: z.string().min(1),
	jobId: z.string().min(1),
	phase: z.enum(['queued', 'running', 'completed', 'failed']),
	scope: feedSyncScopeSchema,
	totalFeeds: z.number().int().nonnegative(),
	completedFeeds: z.number().int().nonnegative(),
	syncedFeeds: z.number().int().nonnegative(),
	failedFeeds: z.number().int().nonnegative(),
	skippedFeeds: z.number().int().nonnegative(),
	newArticles: z.number().int().nonnegative(),
	queuedAt: z.string().min(1).nullable(),
	startedAt: z.string().min(1).nullable(),
	error: z.string().min(1).nullable(),
	updatedAt: z.string().min(1),
});

export const feedHealthUpdatedEventSchema = z.object({
	type: z.literal('feed.health.updated'),
	eventId: z.string().min(1),
	feedId: z.string().min(1),
	severity: z.enum(['healthy', 'warning', 'error']),
	syncStatus: z.enum(['idle', 'syncing', 'error']),
	lastSyncedAt: z.string().min(1).nullable(),
	lastSyncError: z.string().min(1).nullable(),
	lastSyncErrorAt: z.string().min(1).nullable(),
	updatedAt: z.string().min(1),
});

export const realtimeEventSchema = z.discriminatedUnion('type', [
	articleReadStateChangedEventSchema,
	articlesMarkedReadEventSchema,
	articlesNewEventSchema,
	articleUpdatedEventSchema,
	feedSyncProgressEventSchema,
	feedHealthUpdatedEventSchema,
]);

/** @deprecated Use realtimeEventSchema. Kept for existing clients. */
export const readStateSyncEventSchema = realtimeEventSchema;

export type MarkReadInput = z.infer<typeof markReadSchema>;
export type SaveArticleInput = z.infer<typeof saveArticleSchema>;
export type MarkAllReadInput = z.infer<typeof markAllReadSchema>;
export type ArticleQueryInput = z.infer<typeof articleQuerySchema>;
export type ArticleDetailQueryInput = z.infer<typeof articleDetailQuerySchema>;
export type RealtimeEventInput = z.infer<typeof realtimeEventSchema>;
export type ReadStateSyncEventInput = RealtimeEventInput;
