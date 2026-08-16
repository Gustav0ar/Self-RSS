import {
	type AnySQLiteColumn,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core';

interface ReferenceTable {
	id: AnySQLiteColumn;
}

/** Builds the offline mutation tables after the core user/article tables exist. */
export function createArticleStateTables(users: ReferenceTable, articles: ReferenceTable) {
	const articleUserStates = sqliteTable(
		'article_user_states',
		{
			userId: text('user_id')
				.notNull()
				.references(() => users.id, { onDelete: 'cascade' }),
			articleId: text('article_id')
				.notNull()
				.references(() => articles.id, { onDelete: 'cascade' }),
			readRevision: integer('read_revision').notNull().default(0),
			savedRevision: integer('saved_revision').notNull().default(0),
			updatedAt: integer('updated_at', { mode: 'timestamp' })
				.notNull()
				.$defaultFn(() => new Date()),
		},
		(t) => [
			uniqueIndex('article_user_states_pk').on(t.userId, t.articleId),
			index('article_user_states_article_id_idx').on(t.articleId),
		],
	);

	const articleStateMutations = sqliteTable(
		'article_state_mutations',
		{
			userId: text('user_id')
				.notNull()
				.references(() => users.id, { onDelete: 'cascade' }),
			mutationId: text('mutation_id').notNull(),
			articleId: text('article_id')
				.notNull()
				.references(() => articles.id, { onDelete: 'cascade' }),
			kind: text('kind').notNull(),
			desiredState: integer('desired_state', { mode: 'boolean' }).notNull(),
			baseRevision: integer('base_revision'),
			resultingState: integer('resulting_state', { mode: 'boolean' }).notNull(),
			resultingRevision: integer('resulting_revision').notNull(),
			applied: integer('applied', { mode: 'boolean' }).notNull(),
			createdAt: integer('created_at', { mode: 'timestamp' })
				.notNull()
				.$defaultFn(() => new Date()),
		},
		(t) => [
			uniqueIndex('article_state_mutations_pk').on(t.userId, t.mutationId),
			index('article_state_mutations_article_idx').on(t.userId, t.articleId, t.kind),
		],
	);

	return { articleStateMutations, articleUserStates };
}
