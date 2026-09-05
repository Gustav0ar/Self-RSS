import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { applyArticleReadState, applyArticleSavedState } from '@/hooks/queries/cache-utils';
import { dismissOfflineRejections, subscribeOfflineChanges } from '@/lib/offline-changes';
import type { OfflineSnapshot } from '@/lib/offline-snapshot';
import {
	flushOfflineArticleMutations,
	hasPendingArticleStateMutation,
	readOfflineSnapshot,
} from '@/lib/offline-store';

const OfflineStatusContext = createContext<{
	snapshot: OfflineSnapshot | null;
	online: boolean;
	sessionOffline: boolean;
	retrying: boolean;
	retry: () => Promise<void>;
	dismissRejections: () => void;
}>({
	snapshot: null,
	online: true,
	sessionOffline: false,
	retrying: false,
	retry: async () => {},
	dismissRejections: () => {},
});

export function OfflineStatusProvider({
	userId,
	sessionOffline = false,
	children,
}: {
	userId: string | null;
	sessionOffline?: boolean;
	children: ReactNode;
}) {
	const queryClient = useQueryClient();
	const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
	const [online, setOnline] = useState(() => navigator.onLine);
	const [retrying, setRetrying] = useState(false);
	const currentUser = useRef(userId);

	useEffect(() => {
		currentUser.current = userId;
		let disposed = false;
		let refreshing = false;
		let requested = false;
		let cacheDirty = true;
		let previous: OfflineSnapshot | null = null;
		async function refresh(cacheChanged: boolean) {
			setOnline(navigator.onLine);
			cacheDirty ||= cacheChanged;
			requested = true;
			if (!userId || refreshing) return;
			refreshing = true;
			while (requested && !disposed) {
				requested = false;
				const cachedArticles =
					!cacheDirty && previous?.storageAvailable ? previous.articleIds : undefined;
				cacheDirty = false;
				previous = await readOfflineSnapshot(userId, cachedArticles);
				if (!disposed) setSnapshot(previous);
			}
			refreshing = false;
		}
		const update = () => void refresh(true);
		const unsubscribe = subscribeOfflineChanges((cacheChanged) => void refresh(cacheChanged));
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		window.addEventListener('focus', update);
		document.addEventListener('visibilitychange', update);
		update();
		return () => {
			disposed = true;
			currentUser.current = null;
			unsubscribe();
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
			window.removeEventListener('focus', update);
			document.removeEventListener('visibilitychange', update);
		};
	}, [userId]);

	async function retry() {
		if (!userId || !navigator.onLine || retrying) return;
		setRetrying(true);
		try {
			const results = await flushOfflineArticleMutations();
			if (currentUser.current !== userId) return;
			for (const result of results) {
				if (result.authoritativeState === undefined) continue;
				const pending = await hasPendingArticleStateMutation(
					result.mutation.articleId,
					result.mutation.kind,
				);
				if (currentUser.current !== userId) return;
				if (pending) continue;
				const apply =
					result.mutation.kind === 'read' ? applyArticleReadState : applyArticleSavedState;
				apply(queryClient, result.mutation.articleId, result.authoritativeState);
			}
			const next = await readOfflineSnapshot(userId);
			if (currentUser.current !== userId) return;
			if (next.storageAvailable && next.pendingCount === 0 && results.length > 0) {
				void queryClient.invalidateQueries();
			}
		} catch {
			// Failed deliveries remain in the outbox, keeping their count and Retry visible.
		} finally {
			if (currentUser.current === userId) {
				const next = await readOfflineSnapshot(userId);
				if (currentUser.current === userId) {
					setSnapshot(next);
					setRetrying(false);
				}
			}
		}
	}

	return (
		<OfflineStatusContext.Provider
			value={{
				snapshot,
				online,
				sessionOffline,
				retrying,
				retry,
				dismissRejections: () => {
					if (userId) dismissOfflineRejections(userId);
				},
			}}
		>
			{children}
		</OfflineStatusContext.Provider>
	);
}

export function useOfflineStatus() {
	return useContext(OfflineStatusContext);
}
