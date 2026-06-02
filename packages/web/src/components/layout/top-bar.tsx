import { LogOut, Monitor, Moon, Rss, Sun } from 'lucide-react';
import { PreferencesPanel } from '@/components/preferences/preferences-panel';
import { SearchBar } from '@/components/search/search-bar';
import { useUpdatePreferences } from '@/hooks/queries';
import { useAuth } from '@/providers/auth';
import { useTheme } from '@/providers/theme';

interface TopBarProps {
	onSelectArticle?: (id: string) => void;
}

export function TopBar({ onSelectArticle }: TopBarProps) {
	const { resolvedTheme, setTheme, theme } = useTheme();
	const updatePrefs = useUpdatePreferences();
	const { isAuthenticated, logout, username } = useAuth();

	function cycleTheme() {
		const next =
			theme === 'light'
				? 'dark'
				: theme === 'dark'
					? 'amoled'
					: theme === 'amoled'
						? 'system'
						: 'light';
		setTheme(next);
		if (isAuthenticated) {
			updatePrefs.mutate({ theme: next });
		}
	}

	return (
		<header className="relative z-30 px-3 pb-3 pt-3 sm:px-4 sm:pb-4 sm:pt-4">
			<div className="surface-card motion-enter flex h-auto min-h-16 items-center justify-between gap-3 rounded-[1.5rem] px-4 py-3 sm:px-5">
				<div className="flex min-w-0 items-center gap-3">
					<div className="animate-pulse-glow flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
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
					<div className="min-w-0 max-w-xl flex-1 items-center gap-3 lg:flex">
						<div className="min-w-0 flex-1">
							<SearchBar onSelectArticle={onSelectArticle ?? (() => {})} />
						</div>
					</div>
				) : null}

				<div className="flex items-center gap-2 sm:gap-3">
					{isAuthenticated ? <PreferencesPanel /> : null}
					<button
						type="button"
						onClick={cycleTheme}
						className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
							{username ? (
								<div className="surface-muted hidden max-w-52 items-center rounded-full px-3 py-2 text-xs text-muted-foreground md:flex">
									<span className="truncate">{username}</span>
								</div>
							) : null}
							<button
								type="button"
								onClick={logout}
								className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
