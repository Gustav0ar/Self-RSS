import type { ReactNode } from 'react';

/**
 * Context-specific error fallback functions for ErrorBoundary.
 * Each fallback provides a meaningful error message appropriate to its context.
 * Parameters are passed positionally: (error, onReset) as required by ErrorBoundary.
 */

// --- Generic reset button component ---
function ResetButton({ onReset }: { onReset: () => void }) {
	return (
		<button
			type="button"
			onClick={onReset}
			className="rounded-2xl border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
		>
			Try Again
		</button>
	);
}

// --- Auth/Login fallback ---
export function AuthErrorFallback(error: Error, onReset: () => void): ReactNode {
	return (
		<div className="flex min-h-screen items-center justify-center px-4 py-10">
			<div className="surface-card w-full max-w-sm rounded-[2rem] p-8 text-center">
				<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="text-destructive"
						aria-label="Error icon"
					>
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="8" x2="12" y2="12" />
						<line x1="12" y1="16" x2="12.01" y2="16" />
					</svg>
				</div>
				<h2 className="text-lg font-semibold">Authentication Error</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					We couldn&apos;t load the login page. Please try again.
				</p>
				{process.env.NODE_ENV === 'development' && error.stack && (
					<details className="mt-4 text-left">
						<summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
							Technical details
						</summary>
						<pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-muted p-2 text-xs">
							{error.message}
						</pre>
					</details>
				)}
				<div className="mt-6">
					<ResetButton onReset={onReset} />
				</div>
			</div>
		</div>
	);
}

// --- Sidebar fallback ---
export function SidebarErrorFallback(_error: Error, onReset: () => void): ReactNode {
	return (
		<div className="surface-card surface-quiet flex h-full flex-col overflow-hidden rounded-2xl bg-sidebar p-4">
			<div className="flex flex-1 flex-col items-center justify-center text-center">
				<div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="text-destructive"
						aria-label="Error icon"
					>
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="8" x2="12" y2="12" />
						<line x1="12" y1="16" x2="12.01" y2="16" />
					</svg>
				</div>
				<p className="text-sm font-medium">Failed to load feeds</p>
				<p className="mt-1 text-xs text-muted-foreground">
					There was a problem loading your feeds panel.
				</p>
				<div className="mt-4">
					<ResetButton onReset={onReset} />
				</div>
			</div>
		</div>
	);
}

// --- Top bar fallback ---
export function TopBarErrorFallback(_error: Error, onReset: () => void): ReactNode {
	return (
		<header className="relative z-30 px-2 pb-2 pt-2 sm:px-3 sm:pb-3 sm:pt-3">
			<div className="surface-card surface-quiet flex h-auto min-h-14 flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2 sm:flex-nowrap sm:gap-3 sm:px-4">
				<div className="flex items-center gap-2">
					<div className="flex h-10 w-10 animate-pulse-glow items-center justify-center rounded-xl bg-primary/12 text-primary">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-label="RSS icon"
						>
							<path d="M4 11a9 9 0 0 1 9 9" />
							<path d="M4 4a16 16 0 0 1 16 16" />
							<circle cx="5" cy="19" r="1" />
						</svg>
					</div>
					<span className="block truncate text-sm font-semibold tracking-tight sm:text-base">
						SelfFeed
					</span>
				</div>
				<div className="ml-auto flex items-center gap-2">
					<button
						type="button"
						onClick={onReset}
						className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						title="Retry loading"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-label="Refresh icon"
						>
							<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
							<path d="M21 3v5h-5" />
							<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
							<path d="M8 16H3v5" />
						</svg>
					</button>
				</div>
			</div>
		</header>
	);
}

// --- Dialog error fallback factory ---
// Returns a function that matches the ErrorBoundary fallback signature.
// onClose is captured from the dialog's props.
export function createDialogErrorFallback(onClose: () => void) {
	return function DialogErrorFallback(error: Error, onReset: () => void): ReactNode {
		return (
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-md">
				<div className="surface-card motion-scale w-full max-w-md rounded-[1.75rem] p-6 shadow-2xl sm:p-7">
					<div className="mb-5 flex items-start justify-between gap-4">
						<div>
							<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
								Dialog Error
							</p>
							<h2 className="mt-1 text-xl font-semibold tracking-tight">Something went wrong</h2>
						</div>
					</div>
					<div className="space-y-4">
						<div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
							<p>This dialog encountered an error and could not load properly.</p>
						</div>
						{process.env.NODE_ENV === 'development' && error.stack && (
							<details className="text-left">
								<summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
									Technical details
								</summary>
								<pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-muted p-2 text-xs">
									{error.message}
								</pre>
							</details>
						)}
						<div className="flex items-center justify-end gap-2 pt-2">
							<button
								type="button"
								onClick={onClose}
								className="rounded-2xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent"
							>
								Close
							</button>
							<button
								type="button"
								onClick={onReset}
								className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
							>
								Try Again
							</button>
						</div>
					</div>
				</div>
			</div>
		);
	};
}
