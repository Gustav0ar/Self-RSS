import type { ArticleListItem } from '@self-feed/shared';
import type { QueryClient } from '@tanstack/react-query';
import type { OfflineArticleMutationKind, OfflineMutationFlushResult } from '@/lib/offline-store';

export interface RollbackBaseline {
	state: boolean | undefined;
	active: number;
	snapshot: ArticleListItem | null;
}

// Overlapping toggles share the state before the first optimistic change.
// Keep it only until the last mutation settles, updating it from server results.
const baselines = new WeakMap<QueryClient, Map<string, RollbackBaseline>>();

export function beginArticleMutation(
	client: QueryClient,
	articleId: string,
	kind: OfflineArticleMutationKind,
	state: boolean | undefined,
	snapshot: ArticleListItem | null = null,
) {
	const entries = baselines.get(client) ?? new Map<string, RollbackBaseline>();
	baselines.set(client, entries);
	const key = `${kind}:${articleId}`;
	const baseline = entries.get(key) ?? { state, active: 0, snapshot };
	baseline.active += 1;
	entries.set(key, baseline);
	return baseline;
}

export function getSavedMutationSnapshot(client: QueryClient, articleId: string) {
	return baselines.get(client)?.get(`saved:${articleId}`)?.snapshot;
}

// An unsave may remove the only cached row. Keep its rollback copy in sync
// until saving settles, including read mutations that finish in the meantime.
export function updateSavedMutationReadState(
	client: QueryClient,
	articleId: string,
	read: boolean,
) {
	const baseline = baselines.get(client)?.get(`saved:${articleId}`);
	if (baseline?.snapshot) baseline.snapshot = { ...baseline.snapshot, isRead: read };
}

export function finishArticleMutation(
	client: QueryClient,
	articleId: string,
	kind: OfflineArticleMutationKind,
	baseline: RollbackBaseline | undefined,
) {
	const entries = baselines.get(client);
	const key = `${kind}:${articleId}`;
	if (baseline && entries?.get(key) === baseline && --baseline.active === 0) entries.delete(key);
}

export function settledArticleState(
	results: OfflineMutationFlushResult[],
	articleId: string,
	kind: OfflineArticleMutationKind,
	baseline: RollbackBaseline | undefined,
) {
	const relevant = results.filter(
		(result) => result.mutation.articleId === articleId && result.mutation.kind === kind,
	);
	for (const result of relevant) {
		if (baseline && result.authoritativeState !== undefined)
			baseline.state = result.authoritativeState;
	}
	const terminal = relevant.at(-1);
	return terminal?.status === 'discarded' ? baseline?.state : terminal?.authoritativeState;
}
