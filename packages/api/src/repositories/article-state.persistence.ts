import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	articleReads,
	articleSaves,
	articleStateMutations,
	articleUserStates,
} from '../db/schema.js';

export interface ArticleStateMutationResult {
	state: boolean;
	revision: number;
	applied: boolean;
	changed: boolean;
	conflict: boolean;
	duplicate: boolean;
}

interface MutationOptions {
	mutationId?: string;
	baseRevision?: number;
}

export function setArticleReadState(
	db: Database,
	userId: string,
	articleId: string,
	read: boolean,
	source: string,
	options: MutationOptions = {},
): ArticleStateMutationResult {
	return db.transaction((tx) => {
		const currentState = Boolean(
			tx
				.select({ articleId: articleReads.articleId })
				.from(articleReads)
				.where(and(eq(articleReads.userId, userId), eq(articleReads.articleId, articleId)))
				.get(),
		);
		const stateRow = tx
			.select({ revision: articleUserStates.readRevision })
			.from(articleUserStates)
			.where(and(eq(articleUserStates.userId, userId), eq(articleUserStates.articleId, articleId)))
			.get();
		const currentRevision = stateRow?.revision ?? 0;
		const duplicate = findDuplicate(tx, userId, options.mutationId);
		if (duplicate) {
			return duplicateResult(
				currentState,
				currentRevision,
				duplicate,
				articleId,
				'read',
				read,
				options,
			);
		}

		const conflict = options.baseRevision !== undefined && options.baseRevision !== currentRevision;
		const changed = !conflict && currentState !== read;
		const revision = changed ? currentRevision + 1 : currentRevision;
		if (changed) {
			if (read) {
				tx.insert(articleReads)
					.values({ userId, articleId, source })
					.onConflictDoUpdate({
						target: [articleReads.userId, articleReads.articleId],
						set: { source, readAt: new Date() },
					})
					.run();
			} else {
				tx.delete(articleReads)
					.where(and(eq(articleReads.userId, userId), eq(articleReads.articleId, articleId)))
					.run();
			}
			tx.insert(articleUserStates)
				.values({ userId, articleId, readRevision: revision, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: [articleUserStates.userId, articleUserStates.articleId],
					set: { readRevision: revision, updatedAt: new Date() },
				})
				.run();
		}
		const resultingState = changed ? read : currentState;
		recordMutation(
			tx,
			userId,
			articleId,
			'read',
			read,
			resultingState,
			revision,
			conflict,
			options,
		);
		return mutationResult(resultingState, revision, changed, conflict);
	});
}

export function setArticleSavedState(
	db: Database,
	userId: string,
	articleId: string,
	saved: boolean,
	options: MutationOptions = {},
): ArticleStateMutationResult {
	return db.transaction((tx) => {
		const currentState = Boolean(
			tx
				.select({ articleId: articleSaves.articleId })
				.from(articleSaves)
				.where(and(eq(articleSaves.userId, userId), eq(articleSaves.articleId, articleId)))
				.get(),
		);
		const stateRow = tx
			.select({ revision: articleUserStates.savedRevision })
			.from(articleUserStates)
			.where(and(eq(articleUserStates.userId, userId), eq(articleUserStates.articleId, articleId)))
			.get();
		const currentRevision = stateRow?.revision ?? 0;
		const duplicate = findDuplicate(tx, userId, options.mutationId);
		if (duplicate) {
			return duplicateResult(
				currentState,
				currentRevision,
				duplicate,
				articleId,
				'saved',
				saved,
				options,
			);
		}

		const conflict = options.baseRevision !== undefined && options.baseRevision !== currentRevision;
		const changed = !conflict && currentState !== saved;
		const revision = changed ? currentRevision + 1 : currentRevision;
		if (changed) {
			if (saved) {
				tx.insert(articleSaves).values({ userId, articleId }).onConflictDoNothing().run();
			} else {
				tx.delete(articleSaves)
					.where(and(eq(articleSaves.userId, userId), eq(articleSaves.articleId, articleId)))
					.run();
			}
			tx.insert(articleUserStates)
				.values({ userId, articleId, savedRevision: revision, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: [articleUserStates.userId, articleUserStates.articleId],
					set: { savedRevision: revision, updatedAt: new Date() },
				})
				.run();
		}
		const resultingState = changed ? saved : currentState;
		recordMutation(
			tx,
			userId,
			articleId,
			'saved',
			saved,
			resultingState,
			revision,
			conflict,
			options,
		);
		return mutationResult(resultingState, revision, changed, conflict);
	});
}

export function markArticlesRead(db: Database, userId: string, feedIds: string[]): number {
	if (feedIds.length === 0) return 0;
	return db.transaction((tx) => {
		const inserted = tx.all<{ article_id: string }>(sql`
			INSERT INTO article_reads (user_id, article_id, source, read_at)
			SELECT ${userId}, articles.id, 'mark_all', unixepoch()
			FROM articles
			LEFT JOIN article_reads
				ON article_reads.article_id = articles.id
				AND article_reads.user_id = ${userId}
			WHERE articles.feed_id IN (${sql.join(
				feedIds.map((id) => sql`${id}`),
				sql`, `,
			)})
				AND article_reads.user_id IS NULL
			RETURNING article_id
		`);
		if (inserted.length > 0) {
			tx.insert(articleUserStates)
				.values(
					inserted.map((row) => ({
						userId,
						articleId: row.article_id,
						readRevision: 1,
						updatedAt: new Date(),
					})),
				)
				.onConflictDoUpdate({
					target: [articleUserStates.userId, articleUserStates.articleId],
					set: {
						readRevision: sql`${articleUserStates.readRevision} + 1`,
						updatedAt: new Date(),
					},
				})
				.run();
		}
		return inserted.length;
	});
}

export function cleanupArticleStateMutations(
	db: Database,
	cutoff: Date,
	batchSize: number,
): number {
	const limit = Math.max(1, Math.min(5_000, batchSize));
	const cutoffSeconds = Math.floor(cutoff.getTime() / 1_000);
	const deleted = db.all(sql`
		DELETE FROM article_state_mutations
		WHERE rowid IN (
			SELECT rowid
			FROM article_state_mutations
			WHERE created_at <= ${cutoffSeconds}
			ORDER BY created_at ASC
			LIMIT ${limit}
		)
		RETURNING rowid
	`) as Array<{ rowid: number }>;
	return deleted.length;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DuplicateMutation = NonNullable<ReturnType<typeof findDuplicate>>;

function findDuplicate(tx: Transaction, userId: string, mutationId?: string) {
	if (!mutationId) return undefined;
	return tx
		.select({
			articleId: articleStateMutations.articleId,
			kind: articleStateMutations.kind,
			desiredState: articleStateMutations.desiredState,
			baseRevision: articleStateMutations.baseRevision,
			resultingState: articleStateMutations.resultingState,
			resultingRevision: articleStateMutations.resultingRevision,
			applied: articleStateMutations.applied,
		})
		.from(articleStateMutations)
		.where(
			and(
				eq(articleStateMutations.userId, userId),
				eq(articleStateMutations.mutationId, mutationId),
			),
		)
		.get();
}

function duplicateResult(
	state: boolean,
	revision: number,
	duplicate: DuplicateMutation,
	articleId: string,
	kind: 'read' | 'saved',
	desiredState: boolean,
	options: MutationOptions,
): ArticleStateMutationResult {
	const payloadMismatch =
		duplicate.articleId !== articleId ||
		duplicate.kind !== kind ||
		duplicate.desiredState !== desiredState ||
		duplicate.baseRevision !== (options.baseRevision ?? null);
	if (!payloadMismatch) {
		return {
			state: duplicate.resultingState,
			revision: duplicate.resultingRevision,
			applied: duplicate.applied,
			changed: false,
			conflict: !duplicate.applied,
			duplicate: true,
		};
	}
	return {
		state,
		revision,
		applied: false,
		changed: false,
		conflict: true,
		duplicate: true,
	};
}

function recordMutation(
	tx: Transaction,
	userId: string,
	articleId: string,
	kind: 'read' | 'saved',
	desiredState: boolean,
	resultingState: boolean,
	revision: number,
	conflict: boolean,
	options: MutationOptions,
) {
	if (!options.mutationId) return;
	tx.insert(articleStateMutations)
		.values({
			userId,
			mutationId: options.mutationId,
			articleId,
			kind,
			desiredState,
			baseRevision: options.baseRevision,
			resultingState,
			resultingRevision: revision,
			applied: !conflict,
		})
		.run();
}

function mutationResult(
	state: boolean,
	revision: number,
	changed: boolean,
	conflict: boolean,
): ArticleStateMutationResult {
	return { state, revision, applied: !conflict, changed, conflict, duplicate: false };
}
