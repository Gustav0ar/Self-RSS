import { Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from '@/components/ui/dialog';
import { type Preferences, usePreferences, useUpdatePreferences } from '@/hooks/queries';
import { ACCENT_COLOR_OPTIONS, FONT_FAMILY_OPTIONS, normalizeAccentColor } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme';

type WebTheme = 'light' | 'dark' | 'system';
const PREFERENCES_SAVE_DEBOUNCE_MS = 450;

function normalizeThemePreference(theme: string): WebTheme {
	return theme === 'light' || theme === 'system' ? theme : 'dark';
}

function normalizePreferences(prefs: Preferences): Preferences {
	return { ...prefs, theme: normalizeThemePreference(prefs.theme) };
}

export function PreferencesPanel() {
	const { data: prefs, isLoading } = usePreferences();
	const updatePrefs = useUpdatePreferences();
	const { setTheme } = useTheme();
	const [isOpen, setIsOpen] = useState(false);
	const [draftPrefs, setDraftPrefs] = useState<Preferences | null>(null);
	const [pendingPatch, setPendingPatch] = useState<Partial<Preferences> | null>(null);
	const titleId = useId();

	useEffect(() => {
		if (prefs) {
			setDraftPrefs((current) => {
				if (isOpen && current) {
					return current;
				}
				return normalizePreferences(prefs);
			});
		}
	}, [isOpen, prefs]);

	const fontOptions = useMemo(() => {
		if (
			!draftPrefs?.fontFamily ||
			FONT_FAMILY_OPTIONS.some((option) => option.value === draftPrefs.fontFamily)
		) {
			return FONT_FAMILY_OPTIONS;
		}

		return [...FONT_FAMILY_OPTIONS, { label: draftPrefs.fontFamily, value: draftPrefs.fontFamily }];
	}, [draftPrefs?.fontFamily]);

	useEffect(() => {
		if (!isOpen || !pendingPatch) {
			return;
		}

		const timer = window.setTimeout(() => {
			updatePrefs.mutate(pendingPatch);
			setPendingPatch(null);
		}, PREFERENCES_SAVE_DEBOUNCE_MS);

		return () => window.clearTimeout(timer);
	}, [isOpen, pendingPatch, updatePrefs]);

	function closePanel() {
		if (pendingPatch) {
			updatePrefs.mutate(pendingPatch);
			setPendingPatch(null);
		}
		setIsOpen(false);
	}

	if (!isOpen) {
		return (
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground hover:bg-accent hover:text-accent-foreground"
				aria-label="Preferences"
			>
				<Settings className="h-4 w-4" />
			</button>
		);
	}

	if (isLoading || !draftPrefs) {
		return createPortal(
			<Dialog
				onClose={closePanel}
				ariaLabel="Preferences"
				className="fixed inset-0 z-[200] overflow-y-auto bg-slate-950/55 px-4 py-6 backdrop-blur-md"
				panelClassName="surface-card motion-scale mx-auto w-full max-w-2xl rounded-[1.75rem] p-6 shadow-2xl sm:p-7"
			>
				<div className="p-4 text-sm text-muted-foreground">Loading...</div>
			</Dialog>,
			document.body,
		);
	}

	function handleChange<K extends keyof Preferences>(key: K, value: Preferences[K]) {
		const nextValue =
			key === 'theme' && typeof value === 'string' ? normalizeThemePreference(value) : value;
		setDraftPrefs((current) => (current ? { ...current, [key]: nextValue } : current));
		if (key === 'theme' && typeof value === 'string') {
			setTheme(normalizeThemePreference(value));
		}
		if (updatePrefs.isError) {
			updatePrefs.reset();
		}
		setPendingPatch((current) => ({ ...(current ?? {}), [key]: nextValue }));
	}

	const saveStatus = pendingPatch
		? 'Saving shortly'
		: updatePrefs.isPending
			? 'Saving...'
			: updatePrefs.isError
				? 'Could not save changes'
				: 'Saved';

	return createPortal(
		<Dialog
			onClose={closePanel}
			ariaLabelledBy={titleId}
			className="fixed inset-0 z-[200] overflow-y-auto bg-slate-950/55 px-4 py-6 backdrop-blur-md"
			panelClassName="surface-card motion-scale mx-auto w-full max-w-2xl rounded-[1.75rem] p-6 shadow-2xl sm:p-7"
		>
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
						Reader preferences
					</p>
					<h2 id={titleId} className="mt-1 text-xl font-semibold tracking-tight">
						Preferences
					</h2>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						Adjust the look and reading behavior of your workspace.
					</p>
					<p
						className={cn(
							'mt-1 text-xs',
							updatePrefs.isError ? 'text-red-500' : 'text-muted-foreground',
						)}
						aria-live="polite"
					>
						{saveStatus}
					</p>
				</div>
				<button
					type="button"
					onClick={closePanel}
					className="inline-flex h-10 items-center justify-center rounded-2xl px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					Close
				</button>
			</div>

			<div className="grid gap-5 md:grid-cols-2">
				<section className="surface-muted rounded-[1.5rem] p-5">
					<label htmlFor="pref-theme" className="block text-sm font-medium">
						Theme
					</label>
					<div className="mt-3 grid grid-cols-3 gap-2">
						<ThemeChoice
							label="Light"
							icon={<Sun className="h-4 w-4" />}
							active={draftPrefs.theme === 'light'}
							onClick={() => handleChange('theme', 'light')}
						/>
						<ThemeChoice
							label="Dark"
							icon={<Moon className="h-4 w-4" />}
							active={draftPrefs.theme === 'dark'}
							onClick={() => handleChange('theme', 'dark')}
						/>
						<ThemeChoice
							label="System"
							icon={<Monitor className="h-4 w-4" />}
							active={draftPrefs.theme === 'system'}
							onClick={() => handleChange('theme', 'system')}
						/>
					</div>
					<select
						id="pref-theme"
						value={normalizeThemePreference(draftPrefs.theme)}
						onChange={(e) => handleChange('theme', e.target.value)}
						className="sr-only"
					>
						<option value="system">System</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				</section>

				<section className="surface-muted rounded-[1.5rem] p-5">
					<fieldset>
						<legend className="block text-sm font-medium">Accent color</legend>
						<p className="mt-1 text-xs text-muted-foreground">
							Tints buttons, links, and the focus ring.
						</p>
						<div className="mt-4 grid grid-cols-6 gap-2">
							{ACCENT_COLOR_OPTIONS.map((option) => {
								const isActive = normalizeAccentColor(draftPrefs.accentColor) === option.value;
								return (
									<label
										key={option.value}
										className={cn(
											'relative flex h-10 cursor-pointer items-center justify-center rounded-2xl border transition-transform',
											isActive
												? 'scale-105 border-foreground/40 shadow-lg shadow-primary/20'
												: 'border-border/60 hover:scale-105',
										)}
										style={{
											background: `linear-gradient(135deg, ${option.light} 0%, ${option.dark} 100%)`,
										}}
										title={option.value}
									>
										<input
											type="radio"
											name="accent-color"
											value={option.value}
											checked={isActive}
											onChange={() => handleChange('accentColor', option.value)}
											className="sr-only"
											aria-label={option.value}
										/>
										{isActive ? (
											<span className="h-2 w-2 rounded-full bg-white shadow" aria-hidden="true" />
										) : null}
									</label>
								);
							})}
						</div>
					</fieldset>
				</section>

				<section className="surface-muted rounded-[1.5rem] p-5">
					<label htmlFor="pref-font" className="block text-sm font-medium">
						Font Family
					</label>
					<select
						id="pref-font"
						value={draftPrefs.fontFamily}
						onChange={(e) => handleChange('fontFamily', e.target.value)}
						className="input-surface mt-3 h-12 w-full rounded-2xl px-4 text-sm outline-none"
					>
						{fontOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</section>

				<section className="surface-muted rounded-[1.5rem] p-5">
					<label htmlFor="pref-text-size" className="block text-sm font-medium">
						Text Size: {draftPrefs.textSize}px
					</label>
					<input
						id="pref-text-size"
						type="range"
						min={12}
						max={24}
						value={draftPrefs.textSize}
						onChange={(e) => handleChange('textSize', Number(e.target.value))}
						className="mt-4 w-full"
					/>
				</section>

				<section className="surface-muted rounded-[1.5rem] p-5">
					<label htmlFor="pref-density" className="block text-sm font-medium">
						Density
					</label>
					<select
						id="pref-density"
						value={draftPrefs.density}
						onChange={(e) => handleChange('density', e.target.value)}
						className="input-surface mt-3 h-12 w-full rounded-2xl px-4 text-sm outline-none"
					>
						<option value="comfortable">Comfortable</option>
						<option value="compact">Compact</option>
					</select>
				</section>

				<section className="surface-muted rounded-[1.5rem] p-5">
					<label htmlFor="pref-sort" className="block text-sm font-medium">
						Default Sort
					</label>
					<select
						id="pref-sort"
						value={draftPrefs.defaultSort}
						onChange={(e) => handleChange('defaultSort', e.target.value)}
						className="input-surface mt-3 h-12 w-full rounded-2xl px-4 text-sm outline-none"
					>
						<option value="latest">Newest First</option>
						<option value="oldest">Oldest First</option>
					</select>
				</section>

				<section className="surface-muted rounded-[1.5rem] p-5">
					<p className="block text-sm font-medium">Reading options</p>
					<div className="mt-4 space-y-3">
						<ToggleRow
							label="Hide read articles"
							checked={draftPrefs.hideRead}
							onChange={(checked) => handleChange('hideRead', checked)}
						/>
						<ToggleRow
							label="Enable keyboard shortcuts"
							checked={draftPrefs.keyboardShortcutsEnabled}
							onChange={(checked) => handleChange('keyboardShortcutsEnabled', checked)}
						/>
					</div>
				</section>

				<section className="surface-muted rounded-[1.5rem] p-5">
					<label htmlFor="pref-auto-mark" className="block text-sm font-medium">
						Auto-mark as read
					</label>
					<select
						id="pref-auto-mark"
						value={draftPrefs.autoMarkReadMode}
						onChange={(e) => handleChange('autoMarkReadMode', e.target.value)}
						className="input-surface mt-3 h-12 w-full rounded-2xl px-4 text-sm outline-none"
					>
						<option value="disabled">Disabled</option>
						<option value="on_navigate">On Navigate</option>
						<option value="on_open">On Open</option>
					</select>
				</section>
			</div>
		</Dialog>,
		document.body,
	);
}

function ThemeChoice({
	label,
	icon,
	active,
	onClick,
}: {
	label: string;
	icon: React.ReactNode;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={
				active
					? 'flex min-h-[4.5rem] min-w-0 overflow-hidden rounded-2xl bg-primary px-1 py-3 font-medium text-primary-foreground'
					: 'flex min-h-[4.5rem] min-w-0 overflow-hidden rounded-2xl border border-border bg-background/70 px-1 py-3 text-muted-foreground hover:bg-accent hover:text-foreground'
			}
		>
			<span className="flex w-full min-w-0 flex-col items-center justify-center gap-2 text-center">
				{icon}
				<span className="block max-w-full text-center text-[10px] leading-tight sm:text-[11px]">
					{label}
				</span>
			</span>
		</button>
	);
}

function ToggleRow({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm">
			<span>{label}</span>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="h-4 w-4 rounded"
			/>
		</label>
	);
}
