import { desc, relations, sql } from 'drizzle-orm';
import {
	type AnySQLiteColumn,
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
	authSessions: many(authSessions),
	categories: many(categories),
	feeds: many(feeds),
	articleReads: many(articleReads),
	feedRefreshRequests: many(feedRefreshRequests),
	feedDiscoveryCandidates: many(feedDiscoveryCandidates),
	auditLogs: many(auditLogs),
}));

// ─── Auth Sessions ───

export const authSessions = sqliteTable(
	'auth_sessions',
	{
		id: uuidPrimaryKey('id'),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		refreshTokenHash: text('refresh_token_hash').notNull(),
		clientId: text('client_id'),
		deviceName: text('device_name').notNull().default('Unknown device'),
		userAgent: text('user_agent'),
		ipAddress: text('ip_address'),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		lastSeenAt: timestamp('last_seen_at')
			.notNull()
			.$defaultFn(() => new Date()),
		rotatedAt: timestamp('rotated_at')
			.notNull()
			.$defaultFn(() => new Date()),
		expiresAt: timestamp('expires_at').notNull().default(sql`(unixepoch() + 34560000)`),
		revokedAt: timestamp('revoked_at'),
	},
	(t) => [
		index('auth_sessions_user_id_idx').on(t.userId),
		index('auth_sessions_user_revoked_idx').on(t.userId, t.revokedAt),
		index('auth_sessions_expires_at_idx').on(t.expiresAt),
		uniqueIndex('auth_sessions_refresh_token_hash_idx').on(t.refreshTokenHash),
	],
);

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
	user: one(users, { fields: [authSessions.userId], references: [users.id] }),
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
		parentCategoryId: uuid('parent_category_id').references((): AnySQLiteColumn => categories.id, {
			onDelete: 'restrict',
		}),
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
		uniqueIndex('categories_user_root_slug_idx')
			.on(t.userId, t.slug)
			.where(sql`${t.parentCategoryId} IS NULL`),
		uniqueIndex('categories_user_parent_slug_idx')
			.on(t.userId, t.parentCategoryId, t.slug)
			.where(sql`${t.parentCategoryId} IS NOT NULL`),
		index('categories_user_id_idx').on(t.userId),
		index('categories_user_parent_idx').on(t.userId, t.parentCategoryId),
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

// ─── Durable feed ingestion identity ───

export const feedOrigins = sqliteTable(
	'feed_origins',
	{
		id: uuidPrimaryKey('id'),
		scheme: text('scheme').notNull(),
		host: text('host').notNull(),
		port: integer('port').notNull(),
		lastRequestAt: timestamp('last_request_at'),
		nextAllowedRequestAt: timestamp('next_allowed_request_at'),
		retryAfterUntil: timestamp('retry_after_until'),
		blockedUntil: timestamp('blocked_until'),
		blockReason: text('block_reason'),
		circuitState: text('circuit_state').notNull().default('closed'),
		circuitOpenedAt: timestamp('circuit_opened_at'),
		consecutiveFailureCount: integer('consecutive_failure_count').notNull().default(0),
		lastFailureAt: timestamp('last_failure_at'),
		lastSuccessAt: timestamp('last_success_at'),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp('updated_at')
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex('feed_origins_identity_idx').on(t.scheme, t.host, t.port),
		index('feed_origins_next_allowed_idx').on(t.nextAllowedRequestAt),
		index('feed_origins_circuit_idx').on(t.circuitState, t.blockedUntil),
	],
);

export const feedSources = sqliteTable(
	'feed_sources',
	{
		id: uuidPrimaryKey('id'),
		normalizedUrl: text('normalized_url').notNull(),
		requestedUrl: text('requested_url').notNull(),
		resolvedUrl: text('resolved_url'),
		originId: uuid('origin_id')
			.notNull()
			.references(() => feedOrigins.id, { onDelete: 'restrict' }),
		title: text('title'),
		siteUrl: text('site_url'),
		description: text('description'),
		language: text('language'),
		imageUrl: text('image_url'),
		etag: text('etag'),
		lastModified: text('last_modified'),
		lastHttpStatus: integer('last_http_status'),
		lastFetchAt: timestamp('last_fetch_at'),
		lastUnconditionalFetchAt: timestamp('last_unconditional_fetch_at'),
		lastSuccessAt: timestamp('last_success_at'),
		lastChangeAt: timestamp('last_change_at'),
		nextFetchAt: timestamp('next_fetch_at')
			.notNull()
			.$defaultFn(() => new Date()),
		minIntervalSeconds: integer('min_interval_seconds').notNull().default(900),
		consecutiveFailureCount: integer('consecutive_failure_count').notNull().default(0),
		consecutiveUnchangedCount: integer('consecutive_unchanged_count').notNull().default(0),
		backoffUntil: timestamp('backoff_until'),
		circuitState: text('circuit_state').notNull().default('closed'),
		circuitOpenedAt: timestamp('circuit_opened_at'),
		parserVersion: text('parser_version'),
		rawBodyHash: text('raw_body_hash'),
		normalizedPayloadHash: text('normalized_payload_hash'),
		publisherHints: text('publisher_hints', { mode: 'json' }).$type<Record<string, unknown>>(),
		state: text('state').notNull().default('active'),
		lastErrorCode: text('last_error_code'),
		lastErrorDetails: text('last_error_details'),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp('updated_at')
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex('feed_sources_normalized_url_idx').on(t.normalizedUrl),
		index('feed_sources_origin_id_idx').on(t.originId),
		index('feed_sources_due_idx').on(t.state, t.nextFetchAt),
		index('feed_sources_circuit_idx').on(t.circuitState, t.backoffUntil),
		check('feed_sources_min_interval_check', sql`${t.minIntervalSeconds} >= 900`),
	],
);

export const feedOriginsRelations = relations(feedOrigins, ({ many }) => ({
	sources: many(feedSources),
	fetchJobs: many(feedFetchJobs),
}));

export const feedSourcesRelations = relations(feedSources, ({ one, many }) => ({
	origin: one(feedOrigins, { fields: [feedSources.originId], references: [feedOrigins.id] }),
	feeds: many(feeds, { relationName: 'activeFeedSource' }),
	pendingFeeds: many(feeds, { relationName: 'pendingFeedSource' }),
	fetchJobs: many(feedFetchJobs),
	snapshots: many(feedFetchSnapshots),
	refreshItems: many(feedRefreshRequestItems),
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
		sourceId: uuid('source_id').references(() => feedSources.id, { onDelete: 'set null' }),
		pendingSourceId: uuid('pending_source_id').references(() => feedSources.id, {
			onDelete: 'set null',
		}),
		customTitle: text('custom_title'),
		replacementRequestedAt: timestamp('replacement_requested_at'),
		refreshBlockedUntil: timestamp('refresh_blocked_until'),
		lastSyncErrorCode: text('last_sync_error_code'),
		faviconUrl: text('favicon_url'),
		description: text('description'),
		pollingIntervalMinutes: integer('polling_interval_minutes').notNull().default(5),
		lastSyncedAt: timestamp('last_synced_at'),
		lastSyncError: text('last_sync_error'),
		lastSyncErrorAt: timestamp('last_sync_error_at'),
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
		index('feeds_source_id_idx').on(t.sourceId),
		index('feeds_pending_source_id_idx').on(t.pendingSourceId),
		index('feeds_refresh_blocked_until_idx').on(t.refreshBlockedUntil),
		index('feeds_next_sync_at_idx').on(t.nextSyncAt, t.syncStatus),
	],
);

export const feedsRelations = relations(feeds, ({ one, many }) => ({
	user: one(users, { fields: [feeds.userId], references: [users.id] }),
	category: one(categories, { fields: [feeds.categoryId], references: [categories.id] }),
	source: one(feedSources, {
		fields: [feeds.sourceId],
		references: [feedSources.id],
		relationName: 'activeFeedSource',
	}),
	pendingSource: one(feedSources, {
		fields: [feeds.pendingSourceId],
		references: [feedSources.id],
		relationName: 'pendingFeedSource',
	}),
	articles: many(articles),
	syncRuns: many(syncRuns),
	snapshotDeliveries: many(feedSnapshotDeliveries),
	refreshRequestItems: many(feedRefreshRequestItems),
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
		contentStatus: text('content_status').notNull().default('feed_ready'),
		contentVersion: integer('content_version').notNull().default(1),
		enrichmentQueuedAt: timestamp('enrichment_queued_at'),
		enrichmentAttemptedAt: timestamp('enrichment_attempted_at'),
		enrichedAt: timestamp('enriched_at'),
		enrichmentError: text('enrichment_error'),
		enrichmentAttempts: integer('enrichment_attempts').notNull().default(0),
		nextEnrichmentAt: timestamp('next_enrichment_at'),
	},
	(t) => [
		uniqueIndex('articles_feed_guid_idx').on(t.feedId, t.guid),
		index('articles_feed_id_idx').on(t.feedId),
		index('articles_published_at_idx').on(t.publishedAt),
		index('articles_fetched_at_idx').on(t.fetchedAt),
		index('articles_feed_sort_idx').on(
			t.feedId,
			sql`coalesce(${t.publishedAt}, ${t.fetchedAt})`,
			t.id,
		),
		index('articles_sort_idx').on(sql`coalesce(${t.publishedAt}, ${t.fetchedAt})`, t.id),
		index('articles_enrichment_queue_idx').on(t.contentStatus, t.nextEnrichmentAt),
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
		index('article_reads_article_id_idx').on(t.articleId),
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
	(t) => [
		index('sync_runs_feed_id_idx').on(t.feedId),
		index('sync_runs_started_at_idx').on(t.startedAt),
	],
);

export const syncRunsRelations = relations(syncRuns, ({ one }) => ({
	feed: one(feeds, { fields: [syncRuns.feedId], references: [feeds.id] }),
}));

// ─── Durable feed ingestion work ───

export const feedRefreshRequests = sqliteTable(
	'feed_refresh_requests',
	{
		id: uuidPrimaryKey('id'),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		idempotencyKey: text('idempotency_key'),
		scopeType: text('scope_type').notNull().default('all'),
		scopeFeedId: uuid('scope_feed_id').references(() => feeds.id, { onDelete: 'set null' }),
		scopeCategoryId: uuid('scope_category_id').references(() => categories.id, {
			onDelete: 'set null',
		}),
		status: text('status').notNull().default('pending'),
		totalItems: integer('total_items').notNull().default(0),
		pendingItems: integer('pending_items').notNull().default(0),
		runningItems: integer('running_items').notNull().default(0),
		completedItems: integer('completed_items').notNull().default(0),
		failedItems: integer('failed_items').notNull().default(0),
		deadItems: integer('dead_items').notNull().default(0),
		requestedAt: timestamp('requested_at')
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: timestamp('started_at'),
		completedAt: timestamp('completed_at'),
		expiresAt: timestamp('expires_at'),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp('updated_at')
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex('feed_refresh_requests_user_idempotency_idx')
			.on(t.userId, t.idempotencyKey)
			.where(sql`${t.idempotencyKey} IS NOT NULL`),
		index('feed_refresh_requests_user_created_idx').on(t.userId, t.createdAt),
		index('feed_refresh_requests_status_idx').on(t.status, t.updatedAt),
		index('feed_refresh_requests_expiry_idx').on(t.expiresAt),
	],
);

export const feedDiscoveryCandidates = sqliteTable(
	'feed_discovery_candidates',
	{
		id: uuidPrimaryKey('id'),
		requestId: uuid('request_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
		inputUrl: text('input_url').notNull(),
		candidateUrl: text('candidate_url').notNull(),
		normalizedCandidateUrl: text('normalized_candidate_url').notNull(),
		title: text('title'),
		type: text('type').notNull().default('feed'),
		status: text('status').notNull().default('pending'),
		selectedAt: timestamp('selected_at'),
		selectionMetadata: text('selection_metadata', { mode: 'json' }).$type<
			Record<string, unknown>
		>(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp('updated_at')
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex('feed_discovery_candidates_request_url_idx').on(
			t.requestId,
			t.normalizedCandidateUrl,
		),
		index('feed_discovery_candidates_user_request_idx').on(t.userId, t.requestId),
		index('feed_discovery_candidates_expiry_idx').on(t.expiresAt, t.status),
	],
);

export const feedFetchJobs = sqliteTable(
	'feed_fetch_jobs',
	{
		id: uuidPrimaryKey('id'),
		kind: text('kind').notNull().default('scheduled'),
		priority: integer('priority').notNull().default(0),
		sourceId: uuid('source_id')
			.notNull()
			.references(() => feedSources.id, { onDelete: 'restrict' }),
		originId: uuid('origin_id')
			.notNull()
			.references(() => feedOrigins.id, { onDelete: 'restrict' }),
		refreshRequestId: uuid('refresh_request_id').references(() => feedRefreshRequests.id, {
			onDelete: 'set null',
		}),
		snapshotId: uuid('snapshot_id').references((): AnySQLiteColumn => feedFetchSnapshots.id, {
			onDelete: 'set null',
		}),
		status: text('status').notNull().default('queued'),
		availableAt: timestamp('available_at')
			.notNull()
			.$defaultFn(() => new Date()),
		leaseOwner: text('lease_owner'),
		leaseExpiresAt: timestamp('lease_expires_at'),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(5),
		lastErrorCode: text('last_error_code'),
		lastErrorDetails: text('last_error_details'),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp('updated_at')
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: timestamp('started_at'),
		completedAt: timestamp('completed_at'),
		deadAt: timestamp('dead_at'),
	},
	(t) => [
		index('feed_fetch_jobs_claim_idx').on(t.status, t.availableAt, desc(t.priority), t.createdAt),
		index('feed_fetch_jobs_lease_recovery_idx').on(t.status, t.leaseExpiresAt),
		index('feed_fetch_jobs_source_created_idx').on(t.sourceId, t.createdAt),
		index('feed_fetch_jobs_origin_status_idx').on(t.originId, t.status, t.availableAt),
		index('feed_fetch_jobs_refresh_request_idx').on(t.refreshRequestId),
		uniqueIndex('feed_fetch_jobs_active_source_idx')
			.on(t.sourceId)
			.where(sql`${t.status} IN ('queued', 'running')`),
		check('feed_fetch_jobs_attempts_check', sql`${t.attempts} >= 0 AND ${t.maxAttempts} > 0`),
	],
);

export const feedFetchSnapshots = sqliteTable(
	'feed_fetch_snapshots',
	{
		id: uuidPrimaryKey('id'),
		sourceId: uuid('source_id')
			.notNull()
			.references(() => feedSources.id, { onDelete: 'restrict' }),
		jobId: uuid('job_id').references((): AnySQLiteColumn => feedFetchJobs.id, {
			onDelete: 'set null',
		}),
		fetchedAt: timestamp('fetched_at')
			.notNull()
			.$defaultFn(() => new Date()),
		finalUrl: text('final_url').notNull(),
		httpStatus: integer('http_status'),
		contentType: text('content_type'),
		cacheControl: text('cache_control'),
		expires: text('expires'),
		etag: text('etag'),
		lastModified: text('last_modified'),
		rawBody: text('raw_body'),
		rawBodyRef: text('raw_body_ref'),
		rawBodyBytes: integer('raw_body_bytes').notNull().default(0),
		rawBodyHash: text('raw_body_hash'),
		bodyExpiresAt: timestamp('body_expires_at'),
		normalizedPayload: text('normalized_payload'),
		normalizedPayloadBytes: integer('normalized_payload_bytes').notNull().default(0),
		normalizedPayloadHash: text('normalized_payload_hash'),
		parserVersion: text('parser_version'),
		parseState: text('parse_state').notNull().default('pending'),
		parseErrorCode: text('parse_error_code'),
		parseErrorDetails: text('parse_error_details'),
		retainUntil: timestamp('retain_until'),
		cleanupAfter: timestamp('cleanup_after'),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [
		uniqueIndex('feed_fetch_snapshots_job_idx').on(t.jobId).where(sql`${t.jobId} IS NOT NULL`),
		index('feed_fetch_snapshots_source_fetched_idx').on(t.sourceId, t.fetchedAt),
		index('feed_fetch_snapshots_cleanup_idx').on(t.cleanupAfter, t.retainUntil),
		check(
			'feed_fetch_snapshots_body_size_check',
			sql`${t.rawBodyBytes} >= 0 AND ${t.normalizedPayloadBytes} >= 0`,
		),
	],
);

export const feedSnapshotDeliveries = sqliteTable(
	'feed_snapshot_deliveries',
	{
		id: uuidPrimaryKey('id'),
		snapshotId: uuid('snapshot_id')
			.notNull()
			.references(() => feedFetchSnapshots.id, { onDelete: 'cascade' }),
		feedId: uuid('feed_id')
			.notNull()
			.references(() => feeds.id, { onDelete: 'cascade' }),
		status: text('status').notNull().default('pending'),
		availableAt: timestamp('available_at')
			.notNull()
			.$defaultFn(() => new Date()),
		leaseOwner: text('lease_owner'),
		leaseExpiresAt: timestamp('lease_expires_at'),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(5),
		lastErrorCode: text('last_error_code'),
		lastErrorDetails: text('last_error_details'),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp('updated_at')
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: timestamp('started_at'),
		completedAt: timestamp('completed_at'),
		deadAt: timestamp('dead_at'),
	},
	(t) => [
		uniqueIndex('feed_snapshot_deliveries_snapshot_feed_idx').on(t.snapshotId, t.feedId),
		index('feed_snapshot_deliveries_claim_idx').on(t.status, t.availableAt, t.createdAt),
		index('feed_snapshot_deliveries_lease_recovery_idx').on(t.status, t.leaseExpiresAt),
		index('feed_snapshot_deliveries_feed_idx').on(t.feedId, t.status),
		check(
			'feed_snapshot_deliveries_attempts_check',
			sql`${t.attempts} >= 0 AND ${t.maxAttempts} > 0`,
		),
	],
);

export const feedRefreshRequestItems = sqliteTable(
	'feed_refresh_request_items',
	{
		id: uuidPrimaryKey('id'),
		requestId: uuid('request_id')
			.notNull()
			.references(() => feedRefreshRequests.id, { onDelete: 'cascade' }),
		feedId: uuid('feed_id').references(() => feeds.id, { onDelete: 'set null' }),
		sourceId: uuid('source_id').references(() => feedSources.id, { onDelete: 'set null' }),
		jobId: uuid('job_id').references(() => feedFetchJobs.id, { onDelete: 'set null' }),
		status: text('status').notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		lastErrorCode: text('last_error_code'),
		lastErrorDetails: text('last_error_details'),
		createdAt: timestamp('created_at')
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: timestamp('updated_at')
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: timestamp('started_at'),
		completedAt: timestamp('completed_at'),
	},
	(t) => [
		uniqueIndex('feed_refresh_request_items_request_feed_idx').on(t.requestId, t.feedId),
		index('feed_refresh_request_items_request_status_idx').on(t.requestId, t.status),
		index('feed_refresh_request_items_feed_created_idx').on(t.feedId, t.createdAt),
		index('feed_refresh_request_items_job_idx').on(t.jobId),
	],
);

export const feedRefreshRequestsRelations = relations(feedRefreshRequests, ({ one, many }) => ({
	user: one(users, { fields: [feedRefreshRequests.userId], references: [users.id] }),
	scopeFeed: one(feeds, { fields: [feedRefreshRequests.scopeFeedId], references: [feeds.id] }),
	scopeCategory: one(categories, {
		fields: [feedRefreshRequests.scopeCategoryId],
		references: [categories.id],
	}),
	items: many(feedRefreshRequestItems),
	jobs: many(feedFetchJobs),
}));

export const feedDiscoveryCandidatesRelations = relations(feedDiscoveryCandidates, ({ one }) => ({
	user: one(users, { fields: [feedDiscoveryCandidates.userId], references: [users.id] }),
	category: one(categories, {
		fields: [feedDiscoveryCandidates.categoryId],
		references: [categories.id],
	}),
}));

export const feedFetchJobsRelations = relations(feedFetchJobs, ({ one }) => ({
	source: one(feedSources, { fields: [feedFetchJobs.sourceId], references: [feedSources.id] }),
	origin: one(feedOrigins, { fields: [feedFetchJobs.originId], references: [feedOrigins.id] }),
	refreshRequest: one(feedRefreshRequests, {
		fields: [feedFetchJobs.refreshRequestId],
		references: [feedRefreshRequests.id],
	}),
	snapshot: one(feedFetchSnapshots, {
		fields: [feedFetchJobs.snapshotId],
		references: [feedFetchSnapshots.id],
		relationName: 'jobSnapshotPointer',
	}),
}));

export const feedFetchSnapshotsRelations = relations(feedFetchSnapshots, ({ one, many }) => ({
	source: one(feedSources, {
		fields: [feedFetchSnapshots.sourceId],
		references: [feedSources.id],
	}),
	job: one(feedFetchJobs, {
		fields: [feedFetchSnapshots.jobId],
		references: [feedFetchJobs.id],
		relationName: 'snapshotFetchJob',
	}),
	deliveries: many(feedSnapshotDeliveries),
}));

export const feedSnapshotDeliveriesRelations = relations(feedSnapshotDeliveries, ({ one }) => ({
	snapshot: one(feedFetchSnapshots, {
		fields: [feedSnapshotDeliveries.snapshotId],
		references: [feedFetchSnapshots.id],
	}),
	feed: one(feeds, { fields: [feedSnapshotDeliveries.feedId], references: [feeds.id] }),
}));

export const feedRefreshRequestItemsRelations = relations(feedRefreshRequestItems, ({ one }) => ({
	request: one(feedRefreshRequests, {
		fields: [feedRefreshRequestItems.requestId],
		references: [feedRefreshRequests.id],
	}),
	feed: one(feeds, { fields: [feedRefreshRequestItems.feedId], references: [feeds.id] }),
	source: one(feedSources, {
		fields: [feedRefreshRequestItems.sourceId],
		references: [feedSources.id],
	}),
	job: one(feedFetchJobs, {
		fields: [feedRefreshRequestItems.jobId],
		references: [feedFetchJobs.id],
	}),
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
