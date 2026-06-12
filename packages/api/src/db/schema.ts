import { relations } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Helper for generating UUIDs
const uuid = (name: string) => text(name);
const uuidPrimaryKey = (name: string) =>
	text(name)
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

// Helper for boolean columns stored as integer (0 or 1) in SQLite
const boolean = (name: string) => integer(name, { mode: 'boolean' });

// Helper for timestamps stored as Unix seconds in SQLite
const timestamp = (name: string) => integer(name, { mode: 'timestamp' });

// ─── Users ───

export const users = sqliteTable('users', {
	id: uuidPrimaryKey('id'),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	role: text('role').notNull().default('user'),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at')
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: timestamp('updated_at')
		.notNull()
		.$defaultFn(() => new Date()),
});

export const usersRelations = relations(users, ({ one, many }) => ({
	preferences: one(userPreferences, {
		fields: [users.id],
		references: [userPreferences.userId],
	}),
	categories: many(categories),
	feeds: many(feeds),
	articleReads: many(articleReads),
	auditLogs: many(auditLogs),
}));

// ─── App Settings ───

export const appSettings = sqliteTable('app_settings', {
	id: integer('id').primaryKey().default(1),
	registrationLocked: boolean('registration_locked').notNull().default(false),
	updatedAt: timestamp('updated_at')
		.notNull()
		.$defaultFn(() => new Date()),
});

export const auditLogs = sqliteTable(
	'audit_logs',
	{
		id: uuidPrimaryKey('id'),
		adminUserId: uuid('admin_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		action: text('action').notNull(),
		resource: text('resource').notNull(),
		details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [index('audit_logs_admin_user_id_idx').on(t.adminUserId)],
);

// ─── User Preferences ───

export const userPreferences = sqliteTable('user_preferences', {
	userId: uuid('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	theme: text('theme').notNull().default('system'),
	fontFamily: text('font_family').notNull().default('Inter'),
	textSize: integer('text_size').notNull().default(16),
	density: text('density').notNull().default('comfortable'),
	defaultSort: text('default_sort').notNull().default('latest'),
	hideRead: boolean('hide_read').notNull().default(false),
	keyboardShortcutsEnabled: boolean('keyboard_shortcuts_enabled').notNull().default(true),
	autoMarkReadMode: text('auto_mark_read_mode').notNull().default('on_navigate'),
	accentColor: text('accent_color').notNull().default('indigo'),
	createdAt: timestamp('created_at')
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: timestamp('updated_at')
		.notNull()
		.$defaultFn(() => new Date()),
});

// ─── Categories ───

export const categories = sqliteTable(
	'categories',
	{
		id: uuidPrimaryKey('id'),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		parentCategoryId: uuid('parent_category_id'),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp('updated_at')
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex('categories_user_slug_idx').on(t.userId, t.slug),
		index('categories_user_id_idx').on(t.userId),
	],
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
	user: one(users, { fields: [categories.userId], references: [users.id] }),
	parent: one(categories, {
		fields: [categories.parentCategoryId],
		references: [categories.id],
		relationName: 'parentChild',
	}),
	children: many(categories, { relationName: 'parentChild' }),
	feeds: many(feeds),
}));

// ─── Feeds ───

export const feeds = sqliteTable(
	'feeds',
	{
		id: uuidPrimaryKey('id'),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		siteUrl: text('site_url'),
		feedUrl: text('feed_url').notNull(),
		faviconUrl: text('favicon_url'),
		description: text('description'),
		pollingIntervalMinutes: integer('polling_interval_minutes').notNull().default(60),
		lastSyncedAt: timestamp('last_synced_at'),
		// Cached "next time the worker should look at this feed". The
		// scheduler queries by this column with an index, so the due-feed
		// query is an index range scan instead of a per-row function call.
		// New rows get a timestamp from Drizzle's `$defaultFn`; the
		// migration that introduces the column also updates existing
		// rows to a real timestamp, so the SQL default is not used at
		// runtime.
		nextSyncAt: timestamp('next_sync_at')
			.$defaultFn(() => new Date())
			.notNull(),
		syncStatus: text('sync_status').notNull().default('idle'),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp('updated_at')
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex('feeds_user_feed_url_idx').on(t.userId, t.feedUrl),
		index('feeds_user_id_idx').on(t.userId),
		index('feeds_category_id_idx').on(t.categoryId),
		index('feeds_next_sync_at_idx').on(t.nextSyncAt, t.syncStatus),
	],
);

export const feedsRelations = relations(feeds, ({ one, many }) => ({
	user: one(users, { fields: [feeds.userId], references: [users.id] }),
	category: one(categories, { fields: [feeds.categoryId], references: [categories.id] }),
	articles: many(articles),
	syncRuns: many(syncRuns),
}));

// ─── Articles ───

export const articles = sqliteTable(
	'articles',
	{
		id: uuidPrimaryKey('id'),
		feedId: uuid('feed_id')
			.notNull()
			.references(() => feeds.id, { onDelete: 'cascade' }),
		guid: text('guid').notNull(),
		canonicalUrl: text('canonical_url'),
		title: text('title').notNull(),
		author: text('author'),
		excerpt: text('excerpt'),
		contentHtml: text('content_html'),
		contentText: text('content_text'),
		heroImageUrl: text('hero_image_url'),
		publishedAt: timestamp('published_at'),
		fetchedAt: timestamp('fetched_at')
			.notNull()
			.$defaultFn(() => new Date()),
		hash: text('hash').notNull(),
	},
	(t) => [
		uniqueIndex('articles_feed_guid_idx').on(t.feedId, t.guid),
		index('articles_feed_id_idx').on(t.feedId),
		index('articles_published_at_idx').on(t.publishedAt),
	],
);

export const articlesRelations = relations(articles, ({ one, many }) => ({
	feed: one(feeds, { fields: [articles.feedId], references: [feeds.id] }),
	media: many(articleMedia),
	reads: many(articleReads),
}));

// ─── Article Media ───

export const articleMedia = sqliteTable(
	'article_media',
	{
		id: uuidPrimaryKey('id'),
		articleId: uuid('article_id')
			.notNull()
			.references(() => articles.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		provider: text('provider').notNull().default('unknown'),
		url: text('url').notNull(),
		embedUrl: text('embed_url'),
		width: integer('width'),
		height: integer('height'),
		position: integer('position').notNull().default(0),
	},
	(t) => [index('article_media_article_id_idx').on(t.articleId)],
);

export const articleMediaRelations = relations(articleMedia, ({ one }) => ({
	article: one(articles, { fields: [articleMedia.articleId], references: [articles.id] }),
}));

// ─── Article Reads ───

export const articleReads = sqliteTable(
	'article_reads',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		articleId: uuid('article_id')
			.notNull()
			.references(() => articles.id, { onDelete: 'cascade' }),
		readAt: timestamp('read_at')
			.notNull()
			.$defaultFn(() => new Date()),
		source: text('source').notNull().default('manual'),
	},
	(t) => [
		uniqueIndex('article_reads_pk').on(t.userId, t.articleId),
		index('article_reads_user_id_idx').on(t.userId),
	],
);

export const articleReadsRelations = relations(articleReads, ({ one }) => ({
	user: one(users, { fields: [articleReads.userId], references: [users.id] }),
	article: one(articles, { fields: [articleReads.articleId], references: [articles.id] }),
}));

// ─── Sync Runs ───

export const syncRuns = sqliteTable(
	'sync_runs',
	{
		id: uuidPrimaryKey('id'),
		feedId: uuid('feed_id')
			.notNull()
			.references(() => feeds.id, { onDelete: 'cascade' }),
		startedAt: timestamp('started_at')
			.notNull()
			.$defaultFn(() => new Date()),
		finishedAt: timestamp('finished_at'),
		status: text('status').notNull().default('running'),
		httpStatus: integer('http_status'),
		itemCount: integer('item_count').notNull().default(0),
		errorMessage: text('error_message'),
	},
	(t) => [index('sync_runs_feed_id_idx').on(t.feedId)],
);

export const syncRunsRelations = relations(syncRuns, ({ one }) => ({
	feed: one(feeds, { fields: [syncRuns.feedId], references: [feeds.id] }),
}));

// ─── User Metrics Daily ───

export const userMetricsDaily = sqliteTable(
	'user_metrics_daily',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		date: text('date').notNull(),
		articlesReadCount: integer('articles_read_count').notNull().default(0),
		feedsSyncedCount: integer('feeds_synced_count').notNull().default(0),
		searchCount: integer('search_count').notNull().default(0),
	},
	(t) => [uniqueIndex('user_metrics_daily_pk').on(t.userId, t.date)],
);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
	adminUser: one(users, { fields: [auditLogs.adminUserId], references: [users.id] }),
}));
