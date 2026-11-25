import { Component, type ErrorInfo, isValidElement, type ReactNode } from 'react';

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
	onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * ErrorBoundary component that catches JavaScript errors in child components
 * and displays a fallback UI instead of crashing the entire application.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		// Log the error for debugging
		console.error('[ErrorBoundary] Caught error:', error, errorInfo);

		// Call the optional onError callback
		this.props.onError?.(error, errorInfo);
	}

	private handleReset = (): void => {
		this.setState({ hasError: false, error: null });
	};

	override render(): ReactNode {
		const { hasError, error } = this.state;
		const { children, fallback } = this.props;

		if (hasError && error) {
			// If a fallback is provided, use it
			if (fallback) {
				if (typeof fallback === 'function') {
					return fallback(error, this.handleReset);
				}
				if (isValidElement(fallback)) {
					return fallback;
				}
			}

			// Default fallback UI
			return <DefaultErrorFallback error={error} onReset={this.handleReset} />;
		}

		return children;
	}
}

/**
 * Default error fallback UI with dismiss functionality
 */
function DefaultErrorFallback({
	error,
	onReset,
}: {
	error: Error;
	onReset: () => void;
}): ReactNode {
	return (
		<div
			className="m-4 flex min-h-[200px] flex-col items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center"
			role="alert"
		>
			<div className="mb-4 text-destructive">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="mx-auto"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
			</div>

			<h2 className="mb-2 text-xl font-semibold text-foreground">Something went wrong</h2>

			<p className="mb-4 max-w-[400px] text-sm text-muted-foreground">
				{error.message || 'An unexpected error occurred'}
			</p>

			{import.meta.env.DEV && error.stack ? (
				<details className="mb-4 w-full max-w-[600px] text-left">
					<summary className="mb-2 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
						Stack Trace
					</summary>
					<pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-4 text-xs text-foreground">
						{error.stack}
					</pre>
				</details>
			) : null}

			<button
				type="button"
				onClick={onReset}
				className="rounded-xl bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				Try Again
			</button>
		</div>
	);
}
