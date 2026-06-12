import { Link } from '@tanstack/react-router';
import { LogOut, Menu, Monitor, Moon, Rss, Sun } from 'lucide-react';
import { PreferencesPanel } from '@/components/preferences/preferences-panel';
import { SearchBar } from '@/components/search/search-bar';
import { useUpdatePreferences } from '@/hooks/queries';
import { useAuth } from '@/providers/auth';
import { useTheme } from '@/providers/theme';

interface TopBarProps {
	onSelectArticle?: (id: string) => void;
	onOpenSidebar?: () => void;
}

export function TopBar({ onSelectArticle, onOpenSidebar }: TopBarProps) {
	const { resolvedTheme, setTheme, theme } = useTheme();
	const updatePrefs = useUpdatePreferences();
	const { isAuthenticated, logout, username } = useAuth();

	function cycleTheme() {
		const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
		setTheme(next);
		if (isAuthenticated) {
			updatePrefs.mutate({ theme: next });
		}
	}

	return (
		<header className="relative z-30 px-2 pb-2 pt-2 sm:px-3 sm:pb-3 sm:pt-3">
			<div className="surface-card surface-quiet motion-enter flex h-auto min-h-14 flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2 sm:flex-nowrap sm:gap-3 sm:px-4">
				<div className="flex min-w-0 items-center gap-2 sm:gap-3">
					{isAuthenticated && onOpenSidebar ? (
						<button
							type="button"
							onClick={onOpenSidebar}
							aria-label="Open menu"
							className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground lg:hidden"
						>
							<Menu className="h-5 w-5" />
						</button>
					) : null}
					<div className="animate-pulse-glow flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
						<Rss className="h-5 w-5" />
					</div>
					<div className="min-w-0">
						<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
							Daily briefing
						</p>
						<span className="block truncate text-sm font-semibold tracking-tight sm:text-base">
							SelfFeed
						</span>
					</div>
				</div>

				{isAuthenticated ? (
					<div className="order-3 min-w-0 flex-[1_0_100%] items-center gap-3 sm:order-none sm:max-w-2xl sm:flex-1 md:flex">
						<div className="min-w-0 flex-1">
							<SearchBar onSelectArticle={onSelectArticle ?? (() => {})} />
						</div>
					</div>
				) : null}

				<div className="ml-auto flex items-center gap-2 sm:gap-3">
					{isAuthenticated ? <PreferencesPanel /> : null}
					<button
						type="button"
						onClick={cycleTheme}
						className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						aria-label="Toggle theme"
						title={`Theme: ${theme}`}
					>
						{theme === 'system' ? (
							<Monitor className="h-4 w-4" />
						) : resolvedTheme === 'light' ? (
							<Sun className="h-4 w-4" />
						) : (
							<Moon className="h-4 w-4" />
						)}
					</button>
					{isAuthenticated ? (
						<>
							<Link
								to="/stats"
								aria-label="Stats"
								className="hidden h-9 items-center justify-center rounded-xl px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:inline-flex"
							>
								Stats
							</Link>
							{username ? (
								<div className="surface-muted hidden max-w-52 items-center rounded-full px-3 py-1.5 text-xs text-muted-foreground lg:flex">
									<span className="truncate">{username}</span>
								</div>
							) : null}
							<button
								type="button"
								onClick={logout}
								className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground"
								aria-label="Sign out"
							>
								<LogOut className="h-4 w-4" />
							</button>
						</>
					) : null}
				</div>
			</div>
		</header>
	);
}
