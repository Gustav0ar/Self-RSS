import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

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

	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
