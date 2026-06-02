import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppStateProvider, AuthProvider, QueryProvider, ThemeProvider } from './providers';
import { router } from './routes/router';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
	<StrictMode>
		<ThemeProvider>
			<QueryProvider>
				<AuthProvider>
					<AppStateProvider>
						<RouterProvider router={router} />
					</AppStateProvider>
				</AuthProvider>
			</QueryProvider>
		</ThemeProvider>
	</StrictMode>,
);
