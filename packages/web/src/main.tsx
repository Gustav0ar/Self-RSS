import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppStateProvider, AuthProvider, QueryProvider, ThemeProvider, useAuth } from './providers';
import { router } from './routes/router';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
	<StrictMode>
		<ThemeProvider>
			<QueryProvider>
				<AuthProvider>
					<AuthScopedAppState />
				</AuthProvider>
			</QueryProvider>
		</ThemeProvider>
	</StrictMode>,
);

function AuthScopedAppState() {
	const auth = useAuth();
	const resetKey = auth.isAuthenticated ? (auth.username ?? 'authenticated') : 'anonymous';

	return (
		<AppStateProvider resetKey={resetKey}>
			<RouterProvider router={router} />
		</AppStateProvider>
	);
}
