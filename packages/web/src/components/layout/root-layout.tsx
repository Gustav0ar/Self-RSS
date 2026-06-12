import { Outlet, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { LoginPage } from '@/components/auth/login-page';
import { KeyboardHelp } from '@/components/help/keyboard-help';
import { usePreferences } from '@/hooks/queries';
import { useReadStateSync } from '@/hooks/use-read-state-sync';
import {
	ACCENT_COLOR_OPTIONS,
	fontFamilyCss,
	isAccentColor,
	normalizeDensityPreference,
} from '@/lib/preferences';
import { useAppState } from '@/providers/app-state';
import { useAuth } from '@/providers/auth';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

export function RootLayout() {
	const router = useRouter();
	const { isAuthenticated, isLoading } = useAuth();
	const { selectedFeedId, selectedCategoryId } = useAppState();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	useReadStateSync(isAuthenticated);

	function buildSelectionSearch() {
		if (selectedFeedId) {
			return { feedId: selectedFeedId };
		}

		if (selectedCategoryId) {
			return { categoryId: selectedCategoryId };
		}

		return {};
	}

	function navigateToArticle(articleId: string) {
		void router.navigate({
			to: '/articles/$articleId',
			params: { articleId },
			search: buildSelectionSearch(),
		});
	}

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center px-6">
				<div className="surface-card motion-scale rounded-3xl px-8 py-6 text-center">
					<p className="text-sm text-muted-foreground">Loading...</p>
				</div>
			</div>
		);
	}

	if (!isAuthenticated) {
		return <LoginPage />;
	}

	return (
		<div className="app-shell h-full p-2 sm:p-3 lg:p-4">
			<PreferenceRuntimeStyles />
			<div className="flex h-full min-h-0 flex-col rounded-2xl">
				<TopBar onSelectArticle={navigateToArticle} onOpenSidebar={() => setSidebarOpen(true)} />
				<div className="flex min-h-0 flex-1 gap-2 px-2 pb-2 pt-0 sm:gap-3 sm:px-3 sm:pb-3">
					<Sidebar
						selectedFeedId={selectedFeedId}
						selectedCategoryId={selectedCategoryId}
						onSelectAll={() => {
							setSidebarOpen(false);
							void router.navigate({ to: '/' });
						}}
						onSelectFeed={(feedId) => {
							setSidebarOpen(false);
							void router.navigate({ to: '/', search: { feedId } });
						}}
						onSelectCategory={(categoryId) => {
							setSidebarOpen(false);
							void router.navigate({ to: '/', search: { categoryId } });
						}}
					/>
					<main className="surface-card surface-quiet motion-enter min-h-0 flex-1 overflow-hidden rounded-2xl">
						<Outlet />
					</main>
				</div>
			</div>

			{sidebarOpen ? (
				<MobileSidebarDrawer onClose={() => setSidebarOpen(false)}>
					<Sidebar
						variant="drawer"
						selectedFeedId={selectedFeedId}
						selectedCategoryId={selectedCategoryId}
						onSelectAll={() => {
							setSidebarOpen(false);
							void router.navigate({ to: '/' });
						}}
						onSelectFeed={(feedId) => {
							setSidebarOpen(false);
							void router.navigate({ to: '/', search: { feedId } });
						}}
						onSelectCategory={(categoryId) => {
							setSidebarOpen(false);
							void router.navigate({ to: '/', search: { categoryId } });
						}}
					/>
				</MobileSidebarDrawer>
			) : null}

			<KeyboardHelp />
		</div>
	);
}

interface MobileSidebarDrawerProps {
	onClose: () => void;
	children: React.ReactNode;
}

function MobileSidebarDrawer({ onClose, children }: MobileSidebarDrawerProps) {
	useEffect(() => {
		function handleKey(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				onClose();
			}
		}
		window.addEventListener('keydown', handleKey);
		document.body.style.overflow = 'hidden';
		return () => {
			window.removeEventListener('keydown', handleKey);
			document.body.style.overflow = '';
		};
	}, [onClose]);

	return (
		<div className="sidebar-drawer lg:hidden" role="dialog" aria-modal="true" aria-label="Feeds">
			<button
				type="button"
				aria-label="Close menu"
				className="sidebar-drawer__backdrop"
				onClick={onClose}
			/>
			<div className="sidebar-drawer__panel">{children}</div>
		</div>
	);
}

function PreferenceRuntimeStyles() {
	const { data: prefs } = usePreferences();

	useEffect(() => {
		const root = document.documentElement;
		if (!prefs) {
			root.style.removeProperty('--app-font-family');
			root.style.removeProperty('--reader-text-size');
			root.style.removeProperty('--app-accent-light');
			root.style.removeProperty('--app-accent-dark');
			root.dataset.density = 'comfortable';
			return;
		}

		root.style.setProperty('--app-font-family', fontFamilyCss(prefs.fontFamily));
		root.style.setProperty('--reader-text-size', `${prefs.textSize}px`);
		root.dataset.density = normalizeDensityPreference(prefs.density);
		const accent = ACCENT_COLOR_OPTIONS.find(
			(option) =>
				option.value === (isAccentColor(prefs.accentColor) ? prefs.accentColor : 'indigo'),
		);
		if (accent) {
			root.style.setProperty('--app-accent-light', accent.light);
			root.style.setProperty('--app-accent-dark', accent.dark);
		}
	}, [prefs]);

	useEffect(() => {
		return () => {
			const root = document.documentElement;
			root.style.removeProperty('--app-font-family');
			root.style.removeProperty('--reader-text-size');
			root.style.removeProperty('--app-accent-light');
			root.style.removeProperty('--app-accent-dark');
			delete root.dataset.density;
		};
	}, []);

	return null;
}
