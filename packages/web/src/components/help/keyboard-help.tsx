import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ShortcutRow {
	keys: string[];
	label: string;
	hint?: string;
}

const SHORTCUTS: ShortcutRow[] = [
	{ keys: ['j'], label: 'Next article', hint: 'ArrowDown also works' },
	{ keys: ['k'], label: 'Previous article', hint: 'ArrowUp also works' },
	{ keys: ['m'], label: 'Toggle read / unread' },
	{ keys: ['v'], label: 'Open original article' },
	{ keys: ['r'], label: 'Refresh feeds' },
	{ keys: ['Enter'], label: 'Focus the selected article' },
	{ keys: ['/'], label: 'Focus the search bar' },
	{ keys: ['?'], label: 'Show this help' },
	{ keys: ['Esc'], label: 'Close dialogs and panels' },
];

export function KeyboardHelp() {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		function handleKey(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			if (target) {
				const tag = target.tagName;
				if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
					return;
				}
			}

			if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
				event.preventDefault();
				setOpen(true);
			} else if (event.key === 'Escape' && open) {
				event.preventDefault();
				setOpen(false);
			}
		}

		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	}, [open]);

	if (!open) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-md"
			role="dialog"
			aria-modal="true"
			aria-label="Keyboard shortcuts"
		>
			<button
				type="button"
				aria-label="Close shortcuts"
				className="absolute inset-0 cursor-default"
				onClick={() => setOpen(false)}
			/>
			<div className="surface-card motion-scale relative w-full max-w-lg rounded-[1.75rem] p-6 shadow-2xl sm:p-7">
				<div className="mb-5 flex items-start justify-between gap-4">
					<div>
						<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
							Keyboard
						</p>
						<h2 className="mt-1 text-xl font-semibold tracking-tight">Shortcuts</h2>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">
							Move through articles without leaving the keyboard.
						</p>
					</div>
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground hover:bg-accent hover:text-foreground"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<dl className="divide-y divide-border/70">
					{SHORTCUTS.map((row) => (
						<div key={row.label} className="flex items-center justify-between gap-3 py-2.5 text-sm">
							<dt className="min-w-0 flex-1">
								<p className="font-medium text-foreground">{row.label}</p>
								{row.hint ? (
									<p className="mt-0.5 text-xs text-muted-foreground">{row.hint}</p>
								) : null}
							</dt>
							<dd className="flex shrink-0 items-center gap-1">
								{row.keys.map((key) => (
									<kbd
										key={key}
										className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border border-border bg-background/60 px-2 font-mono text-xs text-foreground"
									>
										{key}
									</kbd>
								))}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</div>,
		document.body,
	);
}
