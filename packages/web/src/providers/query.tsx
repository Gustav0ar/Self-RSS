import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { persistQueryClient, restoreQueryClient } from '../lib/offline-store';

export function QueryProvider({ children }: { children: ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 1000 * 60,
						// apiFetch owns the bounded GET retry budget. Retrying the
						// query function here would multiply one read into six requests.
						retry: false,
						refetchOnWindowFocus: false,
					},
				},
			}),
	);
	const [isRestored, setIsRestored] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let persistTimer: ReturnType<typeof setTimeout> | null = null;
		let unsubscribe: () => void = () => {};
		const schedulePersist = () => {
			if (persistTimer) clearTimeout(persistTimer);
			persistTimer = setTimeout(() => void persistQueryClient(queryClient), 500);
		};
		const persistBeforePageHide = () => {
			if (persistTimer) clearTimeout(persistTimer);
			persistTimer = null;
			void persistQueryClient(queryClient);
		};

		void restoreQueryClient(queryClient).finally(() => {
			if (cancelled) return;
			setIsRestored(true);
			unsubscribe = queryClient.getQueryCache().subscribe(schedulePersist);
			window.addEventListener('pagehide', persistBeforePageHide);
		});

		return () => {
			cancelled = true;
			unsubscribe();
			window.removeEventListener('pagehide', persistBeforePageHide);
			if (persistTimer) clearTimeout(persistTimer);
		};
	}, [queryClient]);

	if (!isRestored) return null;
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
