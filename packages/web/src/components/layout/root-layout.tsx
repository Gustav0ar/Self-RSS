import { Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { LoginPage } from '@/components/auth/login-page';
import { ErrorBoundary } from '@/components/ErrorBoundary';
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
import { useTheme } from '@/providers/theme';
import {
	buildArticleRouteSearch,
	type SearchScope,
	validateArticleRouteSearch,
} from '@/routes/article-route-search';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

export function RootLayout() {
	const router = useRouter();
	const routeSearch = useRouterState({
		select: (state) => validateArticleRouteSearch(state.location.search as Record<string, unknown>),
	});
	const { isAuthenticated, isLoading } = useAuth();
	const { selectedFeedId, selectedCategoryId } = useAppState();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const searchQuery = routeSearch.q ?? '';
	const searchScope = routeSearch.searchScope ?? 'all';
	useReadStateSync(isAuthenticated);

	function navigateToArticle(articleId: string) {
		void router.navigate({
			to: '/articles/$articleId',
			params: { articleId },
			search: buildArticleRouteSearch({
				feedId: selectedFeedId,
				categoryId: selectedCategoryId,
			}),
		});
	}

	function buildCurrentSearch(overrides: { q?: string; searchScope?: SearchScope } = {}) {
		return buildArticleRouteSearch({
			feedId: selectedFeedId,
			categoryId: selectedCategoryId,
			q: searchQuery,
			searchScope,
			...overrides,
		});
	}

	function updateSearchQuery(q: string) {
		void router.navigate({
			to: '.',
			search: buildCurrentSearch({ q }),
			replace: true,
		});
	}

	function updateSearchScope(nextScope: SearchScope) {
		void router.navigate({
			to: '.',
			search: buildCurrentSearch({ searchScope: nextScope }),
			replace: true,
		});
	}

	function navigateHome(search = buildArticleRouteSearch()) {
		if (Object.keys(search).length === 0) {
			void router.navigate({ to: '/' });
			return;
		}
		void router.navigate({ to: '/', search });
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
				<TopBar
					onSelectArticle={navigateToArticle}
					onOpenSidebar={() => setSidebarOpen(true)}
					categoryId={selectedCategoryId}
					searchQuery={searchQuery}
					searchScope={searchScope}
					onSearchQueryChange={updateSearchQuery}
					onSearchScopeChange={updateSearchScope}
				/>
				<div className="flex min-h-0 flex-1 gap-2 px-2 pb-2 pt-0 sm:gap-3 sm:px-3 sm:pb-3">
					<Sidebar
						selectedFeedId={selectedFeedId}
						selectedCategoryId={selectedCategoryId}
						onSelectAll={() => {
							setSidebarOpen(false);
							navigateHome(buildArticleRouteSearch({ q: searchQuery, searchScope }));
						}}
						onSelectFeed={(feedId) => {
							setSidebarOpen(false);
							navigateHome(buildArticleRouteSearch({ feedId, q: searchQuery, searchScope }));
						}}
						onSelectCategory={(categoryId) => {
							setSidebarOpen(false);
							navigateHome(
								buildArticleRouteSearch({
									categoryId,
									q: searchQuery,
									searchScope,
								}),
							);
						}}
					/>
					<main className="surface-card surface-quiet motion-enter min-h-0 flex-1 overflow-hidden rounded-2xl">
						<ErrorBoundary>
							<Outlet />
						</ErrorBoundary>
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
							navigateHome(buildArticleRouteSearch({ q: searchQuery, searchScope }));
						}}
						onSelectFeed={(feedId) => {
							setSidebarOpen(false);
							navigateHome(buildArticleRouteSearch({ feedId, q: searchQuery, searchScope }));
						}}
						onSelectCategory={(categoryId) => {
							setSidebarOpen(false);
							navigateHome(
								buildArticleRouteSearch({
									categoryId,
									q: searchQuery,
									searchScope,
								}),
							);
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
	const drawerRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const previousOverflow = document.body.style.overflow;
		const focusableSelector =
			'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
		function handleKey(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== 'Tab') {
				return;
			}
			const focusable = Array.from(
				drawerRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
			).filter((element) => element.offsetParent !== null);
			if (focusable.length === 0) {
				event.preventDefault();
				drawerRef.current?.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		}
		window.addEventListener('keydown', handleKey);
		document.body.style.overflow = 'hidden';
		const focusTimer = window.setTimeout(() => {
			const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(focusableSelector);
			(firstFocusable ?? drawerRef.current)?.focus();
		}, 0);
		return () => {
			window.removeEventListener('keydown', handleKey);
			window.clearTimeout(focusTimer);
			document.body.style.overflow = previousOverflow;
			previouslyFocused?.focus();
		};
	}, [onClose]);

	return (
		<div
			ref={drawerRef}
			className="sidebar-drawer lg:hidden"
			role="dialog"
			aria-modal="true"
			aria-label="Feeds"
			tabIndex={-1}
		>
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
	const { resolvedTheme } = useTheme();

	useEffect(() => {
		const root = document.documentElement;
		if (!prefs) {
			root.style.removeProperty('--app-font-family');
			root.style.removeProperty('--reader-text-size');
			root.style.removeProperty('--app-accent-light');
			root.style.removeProperty('--app-accent-dark');
			removeAccentOverride(root);
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
			applyAccentOverride(root, accent, resolvedTheme);
		} else {
			removeAccentOverride(root);
		}
	}, [prefs, resolvedTheme]);

	useEffect(() => {
		return () => {
			const root = document.documentElement;
			root.style.removeProperty('--app-font-family');
			root.style.removeProperty('--reader-text-size');
			root.style.removeProperty('--app-accent-light');
			root.style.removeProperty('--app-accent-dark');
			removeAccentOverride(root);
			delete root.dataset.density;
		};
	}, []);

	return null;
}

function applyAccentOverride(
	root: HTMLElement,
	accent: (typeof ACCENT_COLOR_OPTIONS)[number],
	resolvedTheme: 'light' | 'dark',
) {
	// Tailwind v4 emits `--color-primary` and `--color-ring` inside its
	// `@theme` block, which sits inside `@layer theme` — anything
	// unlayered (including our `:root { … }` in globals.css) wins by
	// cascade, but inline styles win by CSS specificity. We set inline
	// overrides so the user's choice always takes effect, in both light
	// and dark themes.
	const tone = resolvedTheme === 'dark' ? accent.dark : accent.light;
	root.style.setProperty('--color-primary', tone);
	root.style.setProperty('--color-ring', tone);
}

function removeAccentOverride(root: HTMLElement) {
	root.style.removeProperty('--color-primary');
	root.style.removeProperty('--color-ring');
}
